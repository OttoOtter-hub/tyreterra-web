'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const link = (href: string, label: string) => (
    <Link href={href} className={pathname.startsWith(href) ? 'active' : ''}>
      {label}
    </Link>
  );

  return (
    <nav className="navbar">
      <div className="container navbar-inner">
        <Link href="/catalogue" className="navbar-brand">
          Tyre <span>Terra</span>
        </Link>
        <div className="navbar-links">
          {link('/catalogue', 'Catalogue')}
          {link('/listings', 'My Listings')}
          {link('/requests', 'Requests')}
          {link('/deals', 'Deals')}
          {user?.role === 'admin' && link('/admin', 'Admin')}
        </div>
        <div className="navbar-user">
          <span>{user?.email}</span>
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </div>
    </nav>
  );
}
