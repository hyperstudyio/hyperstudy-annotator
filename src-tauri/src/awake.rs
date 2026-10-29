//! Keeping the Mac from idle-sleeping while a run has steps on other machines. Such a step is driven from this Mac,
//! and one whose driver cannot reach its machine for 600 s is ended there (hyperstudy-perception's `lost_after_s`), so
//! a Mac that idles to sleep during a long remote step loses it. A power assertion that prevents idle system sleep is
//! held while the run goes on (`pmset -g assertions` lists it). It does not stop the sleep of a closed lid. The system
//! releases it when the app's process ends, however it ends, so nothing holds it longer than the app. On other
//! systems it does nothing.

/// Held while it lives: dropping it releases the assertion.
#[derive(Debug)]
pub struct Awake {
    #[cfg(target_os = "macos")]
    id: u32,
}

/// What `pmset -g assertions` shows for it, at most the 128 characters IOKit keeps of an assertion's name.
#[cfg(any(target_os = "macos", test))]
fn name(reason: &str) -> String {
    reason.chars().take(128).collect()
}

#[cfg(target_os = "macos")]
mod iokit {
    use std::ffi::c_void;

    pub type CFStringRef = *const c_void;
    pub const UTF8: u32 = 0x0800_0100;   // kCFStringEncodingUTF8
    pub const ON: u32 = 255;   // kIOPMAssertionLevelOn

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub fn CFStringCreateWithBytes(alloc: *const c_void, bytes: *const u8, len: isize, encoding: u32, external: u8) -> CFStringRef;
        pub fn CFRelease(cf: *const c_void);
    }

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        pub fn IOPMAssertionCreateWithName(kind: CFStringRef, level: u32, name: CFStringRef, id: *mut u32) -> i32;
        pub fn IOPMAssertionRelease(id: u32) -> i32;
    }

    /// A CFString of `s`, released when dropped.
    pub struct CfString(pub CFStringRef);

    impl CfString {
        pub fn new(s: &str) -> Option<CfString> {
            // SAFETY: the bytes are valid for their length; the string copies them
            let r = unsafe { CFStringCreateWithBytes(std::ptr::null(), s.as_ptr(), s.len() as isize, UTF8, 0) };
            (!r.is_null()).then_some(CfString(r))
        }
    }

    impl Drop for CfString {
        fn drop(&mut self) {
            // SAFETY: created above, released once
            unsafe { CFRelease(self.0) }
        }
    }
}

impl Awake {
    /// Prevent idle system sleep until this is dropped, named `reason`. None if the system refused (said where the
    /// app's output goes: the run goes on without it).
    #[cfg(target_os = "macos")]
    pub fn hold(reason: &str) -> Option<Awake> {
        let (Some(kind), Some(named)) = (iokit::CfString::new("PreventUserIdleSystemSleep"), iokit::CfString::new(&name(reason))) else {
            return None;
        };
        let mut id = 0u32;
        // SAFETY: both strings live through the call, which copies them; `id` is written on success
        let r = unsafe { iokit::IOPMAssertionCreateWithName(kind.0, iokit::ON, named.0, &mut id) };
        if r != 0 {
            eprintln!("could not keep the Mac awake for the run (IOKit {r:#x})");
            return None;
        }
        Some(Awake { id })
    }

    #[cfg(not(target_os = "macos"))]
    pub fn hold(_reason: &str) -> Option<Awake> {
        Some(Awake {})
    }
}

#[cfg(target_os = "macos")]
impl Drop for Awake {
    fn drop(&mut self) {
        // SAFETY: an assertion this created, released once
        unsafe { iokit::IOPMAssertionRelease(self.id) };
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn a_name_is_what_iokit_keeps_of_it() {
        assert_eq!(name("HyperStudy Annotator: run r1"), "HyperStudy Annotator: run r1");
        assert_eq!(name(&"é".repeat(200)).chars().count(), 128);   // by characters, never inside one
    }

    /// The assertions `pmset` lists, with their owners and names.
    #[cfg(target_os = "macos")]
    pub fn assertions() -> String {
        let out = std::process::Command::new("pmset").args(["-g", "assertions"]).output().unwrap();
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    /// Whether `pmset` lists a PreventUserIdleSystemSleep assertion named `reason`, polled until it says `want` (powerd
    /// learns of a process's end on its own time).
    #[cfg(target_os = "macos")]
    pub fn listed(reason: &str, want: bool) -> bool {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            let now = assertions().lines().any(|l| l.contains("PreventUserIdleSystemSleep") && l.contains(&format!("named: \"{reason}\"")));
            if now == want || std::time::Instant::now() > deadline {
                return now;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_mac_is_kept_from_idle_sleep_while_it_is_held_and_not_after() {
        let reason = format!("HyperStudy Annotator test {}", uuid::Uuid::new_v4());
        let held = Awake::hold(&reason).expect("IOKit refused the assertion");
        assert!(listed(&reason, true), "not listed while held:\n{}", assertions());
        drop(held);
        assert!(!listed(&reason, false), "still listed once released:\n{}", assertions());
    }

    /// Run as a child by the test below: hold one, named by the environment, until killed.
    #[cfg(target_os = "macos")]
    #[test]
    fn hold_until_killed() {
        let Ok(reason) = std::env::var("AWAKE_TEST_HOLD") else { return };
        let _held = Awake::hold(&reason).unwrap();
        println!("AWAKE HELD");
        std::thread::sleep(std::time::Duration::from_secs(60));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn an_app_that_crashes_holds_nothing() {
        use std::io::BufRead;
        let reason = format!("HyperStudy Annotator test {}", uuid::Uuid::new_v4());
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "awake::tests::hold_until_killed", "--nocapture", "--test-threads=1"])
            .env("AWAKE_TEST_HOLD", &reason).stdout(std::process::Stdio::piped()).spawn().unwrap();
        let out = std::io::BufReader::new(child.stdout.take().unwrap());
        assert!(out.lines().map_while(|l| l.ok()).any(|l| l.contains("AWAKE HELD")), "the child never held one");
        assert!(listed(&reason, true), "not listed while the child holds it:\n{}", assertions());
        child.kill().unwrap();   // SIGKILL: no Drop runs
        child.wait().unwrap();
        assert!(!listed(&reason, false), "still listed after its process was killed:\n{}", assertions());
    }
}
