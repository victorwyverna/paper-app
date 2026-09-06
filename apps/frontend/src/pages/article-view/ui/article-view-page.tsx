import { useParams } from 'react-router';

import styles from '@/shared/ui/page-placeholder/page-placeholder.module.css';

export function ArticleViewPage() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <section className={styles.page}>
      <p className={styles.eyebrow}>Published article</p>
      <h1 className={styles.title}>{slug}</h1>
      <p className={styles.description}>
        The public article view will live here.
      </p>
    </section>
  );
}
