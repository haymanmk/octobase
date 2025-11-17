import type { ReactNode } from 'react';
import '@styles/global.css';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="layout-container">
      {/* Header */}
      <header className="layout-header">
        <div className="header-content">
          <h1>OctoBase</h1>
          <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
          </nav>
        </div>
      </header>

      <div className="layout-main">
        {/* Left Sidebar */}
        <aside className="layout-sidebar-left">
          <h3>Left Sidebar</h3>
          <ul>
            <li><a href="#dashboard">Dashboard</a></li>
            <li><a href="#projects">Projects</a></li>
            <li><a href="#tasks">Tasks</a></li>
            <li><a href="#settings">Settings</a></li>
          </ul>
        </aside>

        {/* Main Content */}
        <main className="layout-content">
          {children}
        </main>

        {/* Right Sidebar */}
        <aside className="layout-sidebar-right">
          <h3>Right Sidebar</h3>
          <div className="sidebar-widget">
            <h4>Recent Activity</h4>
            <p>No recent activity</p>
          </div>
          <div className="sidebar-widget">
            <h4>Quick Links</h4>
            <ul>
              <li><a href="#link1">Link 1</a></li>
              <li><a href="#link2">Link 2</a></li>
            </ul>
          </div>
        </aside>
      </div>

      {/* Footer */}
      <footer className="layout-footer">
        <div className="footer-content">
          <p>&copy; 2025 OctoBase. All rights reserved.</p>
          <div className="footer-links">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/help">Help</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
