// Add the session CSRF token to same-origin mutations made by the admin UIs.
(() => {
  const originalFetch = window.fetch.bind(window)
  window.fetch = (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, window.location.href)
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (url.origin === window.location.origin && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const token = document.querySelector('meta[name="csrf-token"]')?.content
      if (token) {
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
        headers.set('X-CSRF-Token', token)
        init = { ...init, headers }
      }
    }
    return originalFetch(input, init)
  }
})()
