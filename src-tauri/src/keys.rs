//! The user's own keys for the pipeline (API keys, tokens): kept in the system keychain (macOS Keychain, Windows
//! Credential Manager, the Secret Service on Linux) under the service "hyperstudy-annotator", one entry per name.
//!
//! The app hands them to the perception CLI in the environment of each command it runs, where the CLI looks first
//! (its keys.py); the CLI gives a step only the keys its manifest declares. A value never goes to the web view, a file
//! or a log: the frontend learns only whether each key is stored.

use crate::error::{Error, Result};
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::Mutex;

pub const SERVICE: &str = "hyperstudy-annotator";

/// The keys something in the pipeline uses, and what for. Only these can be stored.
pub struct KnownKey {
    pub name: &'static str,
    pub label: &'static str,
    pub purpose: &'static str,
    /// where the user makes one
    pub url: &'static str,
}

pub const KNOWN: &[KnownKey] = &[
    KnownKey { name: "RUNPOD_API_KEY", label: "RunPod", purpose: "Cloud GPU pods (Machines)",
               url: "https://console.runpod.io/user/settings" },
    KnownKey { name: "ANTHROPIC_API_KEY", label: "Anthropic", purpose: "Shot captions (Claude)",
               url: "https://console.anthropic.com/settings/keys" },
    KnownKey { name: "HF_TOKEN", label: "Hugging Face", purpose: "Model downloads (gated models, higher limits)",
               url: "https://huggingface.co/settings/tokens" },
];

fn known(name: &str) -> Result<&'static KnownKey> {
    KNOWN.iter().find(|k| k.name == name).ok_or_else(|| Error::Bundle(format!("not a key the app keeps: {name:?}")))
}

/// Where values are kept: the system keychain, or (tests) memory.
pub trait Store: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<String>>;
    fn set(&self, name: &str, value: &str) -> Result<()>;
    fn delete(&self, name: &str) -> Result<()>;
}

/// The system keychain, under a service name (SERVICE; tests that reach the real keychain use one of their own).
pub struct Keychain(pub &'static str);

fn keychain_error(what: &str, name: &str, e: keyring::Error) -> Error {
    Error::Bundle(match e {
        keyring::Error::NoStorageAccess(_) => format!("the keychain did not let the app {what} {name}: unlock it and try again"),
        keyring::Error::NoDefaultStore => "this computer has no keychain the app can use".to_string(),
        other => format!("the keychain could not {what} {name} ({other})"),
    })
}

impl Store for Keychain {
    fn get(&self, name: &str) -> Result<Option<String>> {
        let entry = keyring::Entry::new(self.0, name).map_err(|e| keychain_error("read", name, e))?;
        match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(keychain_error("read", name, e)),
        }
    }

    fn set(&self, name: &str, value: &str) -> Result<()> {
        let entry = keyring::Entry::new(self.0, name).map_err(|e| keychain_error("store", name, e))?;
        entry.set_password(value).map_err(|e| keychain_error("store", name, e))
    }

    fn delete(&self, name: &str) -> Result<()> {
        let entry = keyring::Entry::new(self.0, name).map_err(|e| keychain_error("remove", name, e))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keychain_error("remove", name, e)),
        }
    }
}

#[cfg(test)]
#[derive(Default)]
pub struct Memory(Mutex<BTreeMap<String, String>>);

#[cfg(test)]
impl Store for Memory {
    fn get(&self, name: &str) -> Result<Option<String>> {
        Ok(self.0.lock().unwrap().get(name).cloned())
    }
    fn set(&self, name: &str, value: &str) -> Result<()> {
        self.0.lock().unwrap().insert(name.to_string(), value.to_string());
        Ok(())
    }
    fn delete(&self, name: &str) -> Result<()> {
        self.0.lock().unwrap().remove(name);
        Ok(())
    }
}

/// What the frontend learns of a key: what it is for and whether the app holds one. Never its value.
#[derive(Debug, Serialize, PartialEq)]
pub struct KeyStatus {
    pub name: &'static str,
    pub label: &'static str,
    pub purpose: &'static str,
    pub url: &'static str,
    pub stored: bool,
}

/// Values for a child's environment, whose Debug shows names only (a Pipeline printed in an error or a log must not
/// carry them).
#[derive(Clone, Default)]
pub struct Secrets(pub Vec<(String, String)>);

impl std::fmt::Debug for Secrets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.0.iter().map(|(k, _)| k)).finish()
    }
}

pub struct Keys {
    store: Box<dyn Store>,
    /// what the keychain held, read once (a locked keychain prompts on each read), kept up to date by set/remove; or
    /// why it could not be read
    cache: Mutex<Option<std::result::Result<BTreeMap<String, String>, String>>>,
}

type Cache<'a> = std::sync::MutexGuard<'a, Option<std::result::Result<BTreeMap<String, String>, String>>>;

impl Keys {
    pub fn new(store: Box<dyn Store>) -> Self {
        Keys { store, cache: Mutex::new(None) }
    }

    fn read_all(&self) -> std::result::Result<BTreeMap<String, String>, String> {
        let mut values = BTreeMap::new();
        for k in KNOWN {
            if let Some(v) = self.store.get(k.name).map_err(|e| e.to_string())? {
                values.insert(k.name.to_string(), v);
            }
        }
        Ok(values)
    }

    /// The cache, read on first use; `again`: also when the last read failed (the user is looking at the keys, and may
    /// have unlocked the keychain since). Commands do not read again: each read of a locked keychain would prompt.
    fn loaded(&self, again: bool) -> Cache<'_> {
        let mut cache = self.cache.lock().unwrap();
        if cache.is_none() || (again && matches!(*cache, Some(Err(_)))) {
            *cache = Some(self.read_all());
        }
        cache
    }

    pub fn status(&self) -> Result<Vec<KeyStatus>> {
        let cache = self.loaded(true);
        let values = cache.as_ref().unwrap().as_ref().map_err(|e| Error::Bundle(e.clone()))?;
        Ok(KNOWN.iter().map(|k| KeyStatus { name: k.name, label: k.label, purpose: k.purpose, url: k.url,
                                             stored: values.contains_key(k.name) }).collect())
    }

    /// Store a key (one line, as pasted: surrounding space trimmed).
    pub fn set(&self, name: &str, value: &str) -> Result<()> {
        let k = known(name)?;
        let value = value.trim();
        if value.is_empty() || value.lines().count() != 1 || value.chars().any(char::is_control) || value.len() > 4096 {
            return Err(Error::Bundle(format!("a {} key is one line of text", k.label)));
        }
        let mut cache = self.loaded(true);
        let values = cache.as_mut().unwrap().as_mut().map_err(|e| Error::Bundle(e.clone()))?;
        self.store.set(name, value)?;
        values.insert(name.to_string(), value.to_string());
        Ok(())
    }

    pub fn remove(&self, name: &str) -> Result<()> {
        known(name)?;
        let mut cache = self.loaded(true);
        let values = cache.as_mut().unwrap().as_mut().map_err(|e| Error::Bundle(e.clone()))?;
        self.store.delete(name)?;
        values.remove(name);
        Ok(())
    }

    /// The stored keys, for the CLI's environment. None when the keychain could not be read: the app's keys are
    /// optional (the CLI also finds keys in files and the environment, and the plan names any a step lacks), and the
    /// Keys row says why (`status`), so the pipeline runs on rather than every command failing.
    pub fn for_cli(&self) -> Secrets {
        match self.loaded(false).as_ref().unwrap() {
            Ok(values) => Secrets(values.iter().map(|(k, v)| (k.clone(), v.clone())).collect()),
            Err(_) => Secrets::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "sk-test-0123456789abcdef";

    #[test]
    fn a_key_is_stored_and_only_whether_it_is_reaches_the_frontend() {
        let keys = Keys::new(Box::new(Memory::default()));
        assert!(keys.status().unwrap().iter().all(|s| !s.stored));
        keys.set("RUNPOD_API_KEY", &format!("  {SECRET}\n")).unwrap();
        let status = keys.status().unwrap();
        assert!(status.iter().find(|s| s.name == "RUNPOD_API_KEY").unwrap().stored);
        assert!(!serde_json::to_string(&status).unwrap().contains(SECRET));   // what the web view gets
        assert_eq!(keys.for_cli().0, vec![("RUNPOD_API_KEY".to_string(), SECRET.to_string())]);   // trimmed
        keys.remove("RUNPOD_API_KEY").unwrap();
        assert!(keys.for_cli().0.is_empty() && !keys.status().unwrap().iter().any(|s| s.stored));
    }

    #[test]
    fn only_known_keys_of_one_line_are_stored() {
        let keys = Keys::new(Box::new(Memory::default()));
        for bad in ["PATH", "LD_PRELOAD", "AWS_SECRET_ACCESS_KEY", "runpod_api_key"] {
            assert!(keys.set(bad, SECRET).is_err(), "{bad}");   // nothing that would change how the CLI runs
        }
        for bad in ["", "   ", "a\nb", "a\rOTHER=x", "a\u{85}b", "a\tb"] {
            assert!(keys.set("HF_TOKEN", bad).is_err(), "{bad:?}");
        }
        assert!(keys.for_cli().0.is_empty());
    }

    #[test]
    fn the_keychain_is_read_once_and_kept_up_to_date() {
        struct Counting(Memory, Mutex<usize>);
        impl Store for Counting {
            fn get(&self, n: &str) -> Result<Option<String>> { *self.1.lock().unwrap() += 1; self.0.get(n) }
            fn set(&self, n: &str, v: &str) -> Result<()> { self.0.set(n, v) }
            fn delete(&self, n: &str) -> Result<()> { self.0.delete(n) }
        }
        let store = Counting(Memory::default(), Mutex::new(0));
        store.0.set("HF_TOKEN", SECRET).unwrap();
        let keys = Keys::new(Box::new(store));
        for _ in 0..3 {
            assert_eq!(keys.for_cli().0.len(), 1);
        }
        keys.set("ANTHROPIC_API_KEY", SECRET).unwrap();
        assert_eq!(keys.for_cli().0.len(), 2);
    }

    #[test]
    fn a_keychain_that_refuses_is_an_error_and_nothing_changes() {
        struct Refusing;
        impl Store for Refusing {
            fn get(&self, _: &str) -> Result<Option<String>> { Ok(None) }
            fn set(&self, _: &str, _: &str) -> Result<()> { Err(Error::Bundle("the keychain is locked".into())) }
            fn delete(&self, _: &str) -> Result<()> { Err(Error::Bundle("the keychain is locked".into())) }
        }
        let keys = Keys::new(Box::new(Refusing));
        assert!(keys.set("HF_TOKEN", SECRET).is_err());
        assert!(keys.for_cli().0.is_empty());   // not cached as stored when the keychain refused
    }

    struct Unreadable(Mutex<usize>);
    impl Store for Unreadable {
        fn get(&self, _: &str) -> Result<Option<String>> {
            *self.0.lock().unwrap() += 1;
            Err(Error::Bundle("this computer has no keychain the app can use".into()))
        }
        fn set(&self, _: &str, _: &str) -> Result<()> { Err(Error::Bundle("no keychain".into())) }
        fn delete(&self, _: &str) -> Result<()> { Err(Error::Bundle("no keychain".into())) }
    }

    #[test]
    fn an_unreadable_keychain_gives_the_cli_no_keys_asks_once_and_is_said_where_keys_are_shown() {
        let keys = Keys::new(Box::new(Unreadable(Mutex::new(0))));
        // the pipeline runs on (the CLI finds keys in files and the environment too): the app's keys are optional
        for _ in 0..3 {
            assert!(keys.for_cli().0.is_empty());
        }
        let err = keys.status().unwrap_err().to_string();   // the Keys row says why
        assert!(err.contains("no keychain"), "{err}");
    }

    #[test]
    fn a_failed_read_is_not_asked_again_by_every_command_but_is_when_the_keys_are_looked_at() {
        let store = std::sync::Arc::new(Unreadable(Mutex::new(0)));
        struct Shared(std::sync::Arc<Unreadable>);
        impl Store for Shared {
            fn get(&self, n: &str) -> Result<Option<String>> { self.0.get(n) }
            fn set(&self, n: &str, v: &str) -> Result<()> { self.0.set(n, v) }
            fn delete(&self, n: &str) -> Result<()> { self.0.delete(n) }
        }
        let keys = Keys::new(Box::new(Shared(store.clone())));
        for _ in 0..5 {
            keys.for_cli();
        }
        assert_eq!(*store.0.lock().unwrap(), 1);   // one try (a locked keychain would prompt each time)
        let _ = keys.status();
        assert_eq!(*store.0.lock().unwrap(), 2);   // looking at the keys tries again (the user may have unlocked it)
    }

    /// The real keychain, under a service of its own (never the app's): `cargo test -- --ignored real_keychain`. Not run
    /// in CI (no keychain there); run on a Mac before a change to how keys are stored.
    #[test]
    #[ignore]
    fn the_real_keychain_stores_reads_and_removes_a_key() {
        let store = Keychain("hyperstudy-annotator-test");
        store.delete("HF_TOKEN").unwrap();   // from an earlier run that stopped halfway
        assert_eq!(store.get("HF_TOKEN").unwrap(), None);
        store.set("HF_TOKEN", SECRET).unwrap();
        assert_eq!(store.get("HF_TOKEN").unwrap().as_deref(), Some(SECRET));
        store.delete("HF_TOKEN").unwrap();
        assert_eq!(store.get("HF_TOKEN").unwrap(), None);
    }

    #[test]
    fn values_never_show_in_debug_output() {
        let s = Secrets(vec![("HF_TOKEN".into(), SECRET.into())]);
        let shown = format!("{s:?}");
        assert!(shown.contains("HF_TOKEN") && !shown.contains(SECRET));
    }
}
