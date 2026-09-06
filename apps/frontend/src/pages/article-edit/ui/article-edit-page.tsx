import { useParams } from 'react-router';

import styles from '@/shared/ui/page-placeholder/page-placeholder.module.css';

export function ArticleEditPage() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <section className={styles.page}>
      <p className={styles.eyebrow}>Edit article</p>
      <h1 className={styles.title}>{slug}</h1>
      <p className={styles.description}>
        The protected article editor will live here.
      </p>
    </section>
  );
}
