/* ============================================================
   RAILMET core: storage, auth, roles & permissions, app shell
   NOTE: this is a static front-end. Users, roles and sessions are
   kept in the browser's localStorage. Wire these functions to a
   real backend API before production use.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- Permission catalogue ---------- */
  const PERMISSIONS = [
    { module: 'Wagons', items: [
      ['wagons.view', 'View live wagon grid & axle monitoring'],
      ['wagons.operate', 'Source/Destination, Reset, Refresh, End Weighment'],
    ]},
    { module: 'Reports', items: [
      ['reports.view', 'View & generate rake reports'],
      ['reports.export', 'Export report as PDF'],
    ]},
    { module: 'Settings', items: [
      ['settings.view', 'View MQTT diagnostics'],
      ['settings.edit', 'Toggle raw data log & save settings'],
    ]},
    { module: 'User Management', items: [
      ['users.view', 'View users'],
      ['users.manage', 'Create, edit, disable & delete users'],
    ]},
    { module: 'Roles & Permissions', items: [
      ['roles.view', 'View roles & permissions'],
      ['roles.manage', 'Create, edit & delete roles'],
    ]},
  ];
  const ALL_PERMS = PERMISSIONS.flatMap(g => g.items.map(i => i[0]));

  /* "manage" implies "view" etc. */
  const IMPLIES = {
    'wagons.operate': ['wagons.view'],
    'reports.export': ['reports.view'],
    'settings.edit': ['settings.view'],
    'users.manage': ['users.view'],
    'roles.manage': ['roles.view'],
  };

  const DEFAULT_ROLES = [
    { id: 'admin', name: 'Administrator', description: 'Full access to every module. System role.', system: true, permissions: ALL_PERMS.slice() },
    { id: 'supervisor', name: 'Supervisor', description: 'Operates weighment, exports reports, views users.',
      permissions: ['wagons.view', 'wagons.operate', 'reports.view', 'reports.export', 'settings.view', 'users.view', 'roles.view'] },
    { id: 'operator', name: 'Operator', description: 'Runs weighment and generates reports.',
      permissions: ['wagons.view', 'wagons.operate', 'reports.view'] },
    { id: 'viewer', name: 'Viewer', description: 'Read-only access to wagons and reports.',
      permissions: ['wagons.view', 'reports.view'] },
  ];

  const DEFAULT_USERS = [
    { username: 'admin', password: 'admin', fullName: 'System Administrator', email: 'admin@railmet.local', roleId: 'admin', active: true },
    { username: 'supervisor', password: 'supervisor', fullName: 'Shift Supervisor', email: 'supervisor@railmet.local', roleId: 'supervisor', active: true },
    { username: 'operator', password: 'operator', fullName: 'Weighbridge Operator', email: 'operator@railmet.local', roleId: 'operator', active: true },
    { username: 'viewer', password: 'viewer', fullName: 'Report Viewer', email: 'viewer@railmet.local', roleId: 'viewer', active: true },
  ];

  const NAV = [
    { href: 'wagons.html',   icon: 'bi-grid-1x2',         label: 'Wagons',   perm: 'wagons.view' },
    { href: 'reports.html',  icon: 'bi-file-earmark-text', label: 'Reports',  perm: 'reports.view' },
    { href: 'settings.html', icon: 'bi-gear',             label: 'Settings', perm: 'settings.view' },
    { href: 'users.html',    icon: 'bi-people',           label: 'Users',    perm: 'users.view' },
    { href: 'roles.html',    icon: 'bi-shield-lock',      label: 'Roles & Permissions', perm: 'roles.view' },
  ];

  /* ---------- Storage ---------- */
  const K = { users: 'rm_users', roles: 'rm_roles', session: 'rm_session', settings: 'rm_settings' };
  const load = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch { return def; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function init() {
    if (!localStorage.getItem(K.roles)) save(K.roles, DEFAULT_ROLES);
    if (!localStorage.getItem(K.users)) {
      const now = new Date().toISOString();
      save(K.users, DEFAULT_USERS.map(u => ({ ...u, createdAt: now, lastLogin: null })));
    }
    // Administrator always keeps every permission
    const roles = load(K.roles, []);
    const admin = roles.find(r => r.id === 'admin');
    if (admin && admin.permissions.length !== ALL_PERMS.length) { admin.permissions = ALL_PERMS.slice(); save(K.roles, roles); }
  }

  /* ---------- Users & roles API ---------- */
  const getUsers = () => load(K.users, []);
  const setUsers = u => save(K.users, u);
  const getRoles = () => load(K.roles, []);
  const setRoles = r => save(K.roles, r);
  const getRole = id => getRoles().find(r => r.id === id);
  const getUser = name => getUsers().find(u => u.username.toLowerCase() === String(name).toLowerCase());

  function withImplied(perms) {
    const set = new Set(perms);
    perms.forEach(p => (IMPLIES[p] || []).forEach(x => set.add(x)));
    return ALL_PERMS.filter(p => set.has(p));
  }

  function saveUser(user, isNew) {
    const users = getUsers();
    const idx = users.findIndex(u => u.username.toLowerCase() === user.username.toLowerCase());
    if (isNew) {
      if (idx >= 0) throw new Error('Username "' + user.username + '" already exists.');
      users.push({ ...user, createdAt: new Date().toISOString(), lastLogin: null });
    } else {
      if (idx < 0) throw new Error('User not found.');
      const merged = { ...users[idx], ...user };
      if (!user.password) merged.password = users[idx].password;
      users[idx] = merged;
    }
    assertAdminRemains(users);
    setUsers(users);
  }

  function deleteUser(username) {
    const users = getUsers().filter(u => u.username !== username);
    assertAdminRemains(users);
    setUsers(users);
  }

  /* At least one active user must be able to manage users and roles */
  function assertAdminRemains(users) {
    const roles = getRoles();
    const ok = users.some(u => {
      if (!u.active) return false;
      const r = roles.find(x => x.id === u.roleId);
      return r && r.permissions.includes('users.manage') && r.permissions.includes('roles.manage');
    });
    if (!ok) throw new Error('At least one active user must keep user & role management access.');
  }

  function saveRole(role, isNew) {
    const roles = getRoles();
    role.permissions = withImplied(role.permissions || []);
    if (isNew) {
      if (roles.some(r => r.name.toLowerCase() === role.name.toLowerCase())) throw new Error('A role named "' + role.name + '" already exists.');
      role.id = role.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
      roles.push(role);
    } else {
      const idx = roles.findIndex(r => r.id === role.id);
      if (idx < 0) throw new Error('Role not found.');
      if (roles[idx].system) role.permissions = ALL_PERMS.slice();
      if (roles.some(r => r.id !== role.id && r.name.toLowerCase() === role.name.toLowerCase())) throw new Error('A role named "' + role.name + '" already exists.');
      roles[idx] = { ...roles[idx], ...role };
    }
    // validate that someone can still administer
    const prev = getRoles();
    setRoles(roles);
    try { assertAdminRemains(getUsers()); } catch (e) { setRoles(prev); throw e; }
    return role;
  }

  function deleteRole(id) {
    const role = getRole(id);
    if (!role) return;
    if (role.system) throw new Error('System roles cannot be deleted.');
    const n = getUsers().filter(u => u.roleId === id).length;
    if (n) throw new Error('Role is assigned to ' + n + ' user(s). Reassign them first.');
    setRoles(getRoles().filter(r => r.id !== id));
  }

  /* ---------- Session ---------- */
  function login(username, password, remember) {
    const u = getUser(username);
    if (!u || u.password !== password) return { ok: false, error: 'Invalid username or password.' };
    if (!u.active) return { ok: false, error: 'Your account is disabled. Contact the system administrator.' };
    const users = getUsers();
    const me = users.find(x => x.username === u.username);
    me.lastLogin = new Date().toISOString();
    setUsers(users);
    const store = remember ? localStorage : sessionStorage;
    (remember ? sessionStorage : localStorage).removeItem(K.session);
    store.setItem(K.session, JSON.stringify({ username: u.username, at: Date.now() }));
    return { ok: true, user: u };
  }

  function clearSession() {
    localStorage.removeItem(K.session);
    sessionStorage.removeItem(K.session);
  }
  function logout() {
    clearSession();
    location.href = 'index.html';
  }

  function currentUser() {
    let s = null;
    try { s = JSON.parse(sessionStorage.getItem(K.session) || localStorage.getItem(K.session)); } catch { }
    if (!s) return null;
    const u = getUser(s.username);
    if (!u || !u.active) return null;
    return u;
  }

  function permsOf(user) {
    const r = user && getRole(user.roleId);
    return r ? r.permissions : [];
  }
  const can = perm => permsOf(currentUser()).includes(perm);

  function homeFor(user) {
    const p = permsOf(user);
    const first = NAV.find(n => p.includes(n.perm));
    return first ? first.href : null;
  }

  /* ---------- Utilities ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const fmtClock = d => pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  const fmtDateTime = iso => iso ? fmtClock(new Date(iso)).slice(0, 16) : '—';
  const t2 = v => (Number(v) || 0).toFixed(2).padStart(5, '0');   // 00.00 style

  function toast(msg, type) {
    let host = document.getElementById('rmToastHost');
    if (!host) { host = document.createElement('div'); host.id = 'rmToastHost'; host.className = 'rm-toast-host'; document.body.appendChild(host); }
    const el = document.createElement('div');
    el.className = 'rm-toast ' + (type || 'ok');
    el.innerHTML = '<i class="bi ' + (type === 'error' ? 'bi-exclamation-triangle' : 'bi-check-circle') + '"></i><span>' + esc(msg) + '</span>';
    host.appendChild(el);
    setTimeout(() => el.classList.add('hide'), 2800);
    setTimeout(() => el.remove(), 3200);
  }

  function confirmDialog(title, message, okLabel, danger) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.innerHTML =
        '<div class="modal fade" tabindex="-1"><div class="modal-dialog modal-dialog-centered modal-sm"><div class="modal-content rm-modal">' +
        '<div class="modal-header"><h6>' + esc(title) + '</h6><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>' +
        '<div class="modal-body" style="font-size:13px;">' + esc(message) + '</div>' +
        '<div class="modal-footer"><button class="rm-btn rm-btn-gray" data-bs-dismiss="modal">Cancel</button>' +
        '<button class="rm-btn ' + (danger ? 'rm-btn-red' : 'rm-btn-blue') + '" data-ok>' + esc(okLabel || 'OK') + '</button></div></div></div></div>';
      const el = wrap.firstChild;
      document.body.appendChild(el);
      const m = new bootstrap.Modal(el);
      let result = false;
      el.querySelector('[data-ok]').onclick = () => { result = true; m.hide(); };
      el.addEventListener('hidden.bs.modal', () => { el.remove(); resolve(result); });
      m.show();
    });
  }

  /* ---------- App shell (header + sidebar), same markup as the original ---------- */
  function navHtml(perms, page) {
    return NAV.filter(n => perms.includes(n.perm)).map(n =>
      '<a href="' + n.href + '" class="rm-nav-item' + (n.href.startsWith(page) ? ' active' : '') + '"' + (n.href.startsWith(page) ? ' aria-current="page"' : '') + '>' +
      '<i class="bi ' + n.icon + '"></i> ' + n.label + '</a>').join('');
  }

  /**
   * boot({ page: 'wagons', perm: 'wagons.view' })
   * Guards the page, builds header/sidebar around <main class="rm-content">.
   * Returns the current user (or null if redirected).
   */
  function boot(opts) {
    init();
    const user = currentUser();
    if (!user) { location.replace('index.html'); return null; }
    const role = getRole(user.roleId) || { name: '—', permissions: [] };
    const perms = role.permissions;
    const main = document.querySelector('main.rm-content');

    const header =
      '<div class="rm-top-strip"></div>' +
      '<div class="rm-header">' +
        '<button class="rm-burger" id="sidebarToggle" aria-label="Menu"><i class="bi bi-list"></i></button>' +
        '<div class="rm-header-brand"><span class="rm-logo-railmet">RAILMET</span><span class="rm-logo-speed">SPEEDMATTERS</span></div>' +
        '<div class="rm-header-center">RAIL IN-MOTION WEIGHING SYSTEM</div>' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
          '<div class="rm-mqtt-indicator connected" id="mqttIndicator" title="MQTT: Connected"><i class="bi bi-broadcast"></i><span>MQTT</span></div>' +
          '<div class="rm-header-date" id="headerClock">' + fmtClock(new Date()) + '</div>' +
          '<div class="dropdown">' +
            '<button class="rm-user-chip" data-bs-toggle="dropdown" aria-expanded="false">' +
              '<span class="rm-avatar">' + esc(initials(user.fullName || user.username)) + '</span>' +
              '<span class="rm-user-meta"><span class="rm-user-name">' + esc(user.fullName || user.username) + '</span><span class="rm-user-role">' + esc(role.name) + '</span></span>' +
              '<i class="bi bi-chevron-down" style="font-size:10px;"></i></button>' +
            '<ul class="dropdown-menu dropdown-menu-end rm-dropdown">' +
              '<li class="rm-dd-head"><div class="rm-user-name" style="color:#1a1a2e">' + esc(user.fullName || user.username) + '</div><div style="font-size:11px;color:#718096">@' + esc(user.username) + ' · ' + esc(role.name) + '</div></li>' +
              '<li><button class="dropdown-item" id="btnChangePwd"><i class="bi bi-key"></i> Change password</button></li>' +
              '<li><hr class="dropdown-divider"></li>' +
              '<li><button class="dropdown-item text-danger" id="btnLogout"><i class="bi bi-box-arrow-right"></i> Logout</button></li>' +
            '</ul></div>' +
        '</div>' +
      '</div>';

    const sidebar =
      '<aside class="rm-sidebar" id="desktopSidebar">' +
        '<div class="rm-sidebar-logo"><span class="rm-sb-railmet">RAILMET</span> <span class="rm-sb-speed">SPEEDMATTERS</span></div>' +
        '<nav class="rm-sidebar-nav">' + navHtml(perms, opts.page) + '</nav>' +
      '</aside><div class="rm-sidebar-backdrop" id="sidebarBackdrop"></div>';

    document.body.insertAdjacentHTML('afterbegin', header + '<div class="rm-body" id="rmBody">' + sidebar + '</div>');
    document.getElementById('rmBody').appendChild(main);

    // clock (same format as original: dd/mm/yyyy hh:mm:ss)
    const clock = document.getElementById('headerClock');
    setInterval(() => { clock.textContent = fmtClock(new Date()); }, 1000);

    // mobile sidebar
    const sb = document.getElementById('desktopSidebar'), bd = document.getElementById('sidebarBackdrop');
    const toggle = show => { sb.classList.toggle('offcanvas-show', show); bd.classList.toggle('show', show); };
    document.getElementById('sidebarToggle').onclick = () => toggle(!sb.classList.contains('offcanvas-show'));
    bd.onclick = () => toggle(false);

    document.getElementById('btnLogout').onclick = logout;
    document.getElementById('btnChangePwd').onclick = openChangePassword;

    // permission guard
    if (opts.perm && !perms.includes(opts.perm)) {
      main.innerHTML =
        '<div class="rm-panel" style="flex:1;display:flex;align-items:center;justify-content:center;">' +
        '<div class="rm-empty-state" style="padding:60px 20px;"><i class="bi bi-shield-lock" style="color:#DC2626"></i>' +
        '<div class="rm-empty-title">Access denied</div>' +
        '<div class="rm-empty-desc">Your role (' + esc(role.name) + ') does not have the <code>' + esc(opts.perm) + '</code> permission.</div>' +
        (homeFor(user) ? '<a class="rm-btn rm-btn-blue" style="margin-top:14px" href="' + homeFor(user) + '"><i class="bi bi-house"></i> Go to home</a>' : '') +
        '</div></div>';
      main.hidden = false;
      return null;
    }
    main.hidden = false;
    return user;
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('') || '?';
  }

  function openChangePassword() {
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="modal fade" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><form class="modal-content rm-modal" novalidate>' +
      '<div class="modal-header"><h6><i class="bi bi-key"></i> Change Password</h6><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>' +
      '<div class="modal-body">' +
        '<div class="rm-form-error" hidden></div>' +
        '<div class="mb-3"><label class="rm-form-label">Current password</label><input type="password" class="rm-filter-select" name="cur" required></div>' +
        '<div class="mb-3"><label class="rm-form-label">New password</label><input type="password" class="rm-filter-select" name="pw" minlength="4" required></div>' +
        '<div><label class="rm-form-label">Confirm new password</label><input type="password" class="rm-filter-select" name="pw2" required></div>' +
      '</div>' +
      '<div class="modal-footer"><button type="button" class="rm-btn rm-btn-gray" data-bs-dismiss="modal">Cancel</button><button class="rm-btn rm-btn-blue"><i class="bi bi-check-lg"></i> Update</button></div>' +
      '</form></div></div>';
    const el = wrap.firstChild; document.body.appendChild(el);
    const m = new bootstrap.Modal(el); m.show();
    el.addEventListener('hidden.bs.modal', () => el.remove());
    const form = el.querySelector('form'), err = el.querySelector('.rm-form-error');
    form.onsubmit = e => {
      e.preventDefault();
      const me = currentUser();
      const f = Object.fromEntries(new FormData(form));
      const fail = msg => { err.textContent = msg; err.hidden = false; };
      if (f.cur !== me.password) return fail('Current password is incorrect.');
      if (f.pw.length < 4) return fail('New password must be at least 4 characters.');
      if (f.pw !== f.pw2) return fail('Passwords do not match.');
      const users = getUsers(); users.find(u => u.username === me.username).password = f.pw; setUsers(users);
      m.hide(); toast('Password updated.');
    };
  }

  global.RM = {
    PERMISSIONS, ALL_PERMS, IMPLIES, NAV, K, load, save, init,
    getUsers, getRoles, getRole, getUser, saveUser, deleteUser, saveRole, deleteRole, withImplied,
    login, logout, clearSession, currentUser, permsOf, can, homeFor, boot,
    esc, pad, t2, fmtClock, fmtDateTime, toast, confirmDialog,
  };
})(window);
