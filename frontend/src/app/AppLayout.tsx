import { NavLink, Outlet } from "react-router-dom";

const navItems = [
  { to: "/questions/new", label: "Single Question" },
  { to: "/papers/new", label: "Paper Test" },
  { to: "/jobs", label: "Jobs & Monitoring" },
];

export function AppLayout() {
  return (
    <>
      <header className="app-navbar">
        <NavLink to="/questions/new" className="brand">
          <span className="brand-mark">ET</span>
          <span>
            <span className="brand-title">English Test</span>
            <span className="brand-subtitle">Generation Console</span>
          </span>
        </NavLink>
        <nav className="nav-links" aria-label="Primary navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="page-shell">
        <Outlet />
      </main>
    </>
  );
}
