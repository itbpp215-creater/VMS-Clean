/* Login uses only the server-issued HttpOnly session cookie. Browser storage
   never receives the JWT, so injected client script cannot steal the token. */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const btn = document.getElementById('btnLogin');
  const spin = document.getElementById('spin');
  const errorMsg = document.getElementById('errorMsg');

  /**
   * Redirect an already authenticated browser without reading the HttpOnly
   * cookie. A failed or unavailable session check leaves the login form usable.
   */
  async function redirectAuthenticatedSession() {
    try {
      const response = await fetch('/auth/session', {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (response.ok) window.location.replace('/index.html');
    } catch (error) {
      // Network errors are intentionally ignored so the form can report a
      // clearer error if the user chooses to submit credentials.
    }
  }

  /**
   * Exchange credentials for an HttpOnly cookie and update the form state.
   * The response body contains identity metadata only; no bearer token is
   * copied into JavaScript-accessible storage.
   */
  async function submitLogin(event) {
    event.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    if (!username || !password) return;

    // Keep the form locked for the complete request to prevent duplicate
    // attempts from consuming the brute-force allowance unexpectedly.
    btn.disabled = true;
    spin.hidden = false;
    errorMsg.hidden = true;

    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (response.ok) {
        window.location.replace('/index.html');
        return;
      }
      errorMsg.textContent = data.detail || 'เข้าสู่ระบบไม่สำเร็จ';
      errorMsg.hidden = false;
    } catch (error) {
      errorMsg.textContent = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้';
      errorMsg.hidden = false;
    } finally {
      btn.disabled = false;
      spin.hidden = true;
    }
  }

  form.addEventListener('submit', submitLogin);
  redirectAuthenticatedSession();
});
