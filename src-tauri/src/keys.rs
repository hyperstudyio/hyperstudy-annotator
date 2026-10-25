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

pub struct Keychain;

fn keychain_error(what: &str, name: &str, e: keyring::Error) -> Error {
    Error::Bundle(match e {
        keyring::Error::NoStorageAccess(_) => format!("the keychain did not let the app {what} {name}: unlock it and try again"),
        keyring::Error::NoDefaultStore => "this computer has no keychain the app can use".to_string(),
        other => format!("the keychain could not {what} {name} ({other})"),
    })
}

impl Store for Keychain {
    fn get(&self, name: &str) -> Result<Option<String>> {
        let entry = keyring::Entry::new(SERVICE, name).map_err(|e| keychain_error("read", name, e))?;
        match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(keychain_error("read", name, e)),
        }
    }

    fn set(&self, name: &str, value: &str) -> Result<()> {
        let entry = keyring::Entry::new(SERVICE, name).map_err(|e| keychain_error("store", name, e))?;
        entry.set_password(value).map_err(|e| keychain_error("store", name, e))
    }

    fn delete(&self, name: &str) -> Result<()> {
        let entry = keyring::Entry::new(SERVICE, name).map_err(|e| keychain_error("remove", name, e))?;
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
    /// what the keychain held, read once (each read can ask the user on some systems), kept up to date by set/remove
    cache: Mutex<Option<BTreeMap<String, String>>>,
}

impl Keys {
    pub fn new(store: Box<dyn Store>) -> Self {
        Keys { store, cache: Mutex::new(None) }
    }

    fn loaded(&self) -> Result<std::sync::MutexGuard<'_, Option<BTreeMap<String, String>>>> {
        let mut cache = self.cache.lock().unwrap();
        if cache.is_none() {
            let mut values = BTreeMap::new();
            for k in KNOWN {
                if let Some(v) = self.store.get(k.name)? {
                    values.insert(k.name.to_string(), v);
                }
            }
            *cache = Some(values);
        }
        Ok(cache)
    }

    pub fn status(&self) -> Result<Vec<KeyStatus>> {
        let cache = self.loaded()?;
        let values = cache.as_ref().unwrap();
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
        let mut cache = self.loaded()?;
        self.store.set(name, value)?;
        cache.as_mut().unwrap().insert(name.to_string(), value.to_string());
        Ok(())
    }

    pub fn remove(&self, name: &str) -> Result<()> {
        known(name)?;
        let mut cache = self.loaded()?;
        self.store.delete(name)?;
        cache.as_mut().unwrap().remove(name);
        Ok(())
    }

    /// The stored keys, for the CLI's environment.
    pub fn secrets(&self) -> Result<Secrets> {
        let cache = self.loaded()?;
        Ok(Secrets(cache.as_ref().unwrap().iter().map(|(k, v)| (k.clone(), v.clone())).collect()))
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
        assert_eq!(keys.secrets().unwrap().0, vec![("RUNPOD_API_KEY".to_string(), SECRET.to_string())]);   // trimmed
        keys.remove("RUNPOD_API_KEY").unwrap();
        assert!(keys.secrets().unwrap().0.is_empty() && !keys.status().unwrap().iter().any(|s| s.stored));
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
        assert!(keys.secrets().unwrap().0.is_empty());
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
            assert_eq!(keys.secrets().unwrap().0.len(), 1);
        }
        keys.set("ANTHROPIC_API_KEY", SECRET).unwrap();
        assert_eq!(keys.secrets().unwrap().0.len(), 2);
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
        assert!(keys.secrets().unwrap().0.is_empty());   // not cached as stored when the keychain refused
    }

    #[test]
    fn values_never_show_in_debug_output() {
        let s = Secrets(vec![("HF_TOKEN".into(), SECRET.into())]);
        let shown = format!("{s:?}");
        assert!(shown.contains("HF_TOKEN") && !shown.contains(SECRET));
    }
}
