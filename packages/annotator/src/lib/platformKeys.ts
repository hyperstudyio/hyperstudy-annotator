// The modifier keys as this platform names them. A Mac's command key is Ctrl elsewhere (Linux's Super key belongs to
// the window manager, and a Mac's Ctrl-click is a right-click): the keys accept either, the hints name the one to use.
export const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** The command key's hint: "⌘" on a Mac, "Ctrl+" elsewhere (followed by the key: ⌘Z, Ctrl+Z). */
export const CMD = MAC ? '⌘' : 'Ctrl+';
/** The option key's hint: "⌥" on a Mac, "Alt+" elsewhere. */
export const ALT = MAC ? '⌥' : 'Alt+';
/** Whether this press holds the command key (Ctrl off a Mac). */
export const cmdKey = (e: KeyboardEvent | MouseEvent) => (MAC ? e.metaKey : e.ctrlKey || e.metaKey);
