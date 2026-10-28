/**
 * 404 Not Found page.
 */

import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button.jsx';
import styles from './NotFoundPage.module.css';

export function NotFoundPage() {
  return (
    <main className={styles.main}>
      <div className={styles.content}>
        <span className={styles.code} aria-hidden="true">404</span>
        <h1 className={styles.title}>Page not found</h1>
        <p className={styles.desc}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link to="/">
          <Button variant="primary">Go home</Button>
        </Link>
      </div>
    </main>
  );
}

