// Light or dark mode: the player's choice, if they've made one with the toggle in the main page's
// header, otherwise the system's. The stylesheets key their dark colors off <html data-theme="dark">.
//
// Every page loads this in its <head>, as a plain script rather than a module, so it runs before
// the page is drawn and the other theme never flashes up first.

(() => {
    const KEY = 'theme'
    const system = matchMedia('(prefers-color-scheme: dark)')
    let chosen = null // The player's choice, if storage is unavailable

    const saved = () => {
        try { return localStorage.getItem(KEY) || chosen }
        catch { return chosen }
    }
    const current = () => saved() || (system.matches ? 'dark' : 'light')

    function apply() {
        const theme = current()
        document.documentElement.dataset.theme = theme
        const button = document.getElementById('theme-toggle')
        if (button) {
            const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`
            button.title = label
            button.setAttribute('aria-label', label)
        }
    }

    apply()
    system.addEventListener('change', apply) // Follows the system until the player chooses
    window.addEventListener('storage', (event) => { if (event.key === KEY) { apply() } }) // Chosen in another tab
    document.addEventListener('DOMContentLoaded', () => {
        apply()
        document.getElementById('theme-toggle')?.addEventListener('click', () => {
            chosen = current() === 'dark' ? 'light' : 'dark'
            try { localStorage.setItem(KEY, chosen) }
            catch { /* Storage unavailable: it lasts until the page closes */ }
            apply()
        })
    })
})()
