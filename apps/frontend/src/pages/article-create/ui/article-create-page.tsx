import styles from '@/shared/ui/page-placeholder/page-placeholder.module.css';

export function ArticleCreatePage() {
  return (
    <section className={styles.page}>
      <p className={styles.eyebrow}>Write. Publish. Share.</p>
      <h1 className={styles.title}>Create an article</h1>
      <p className={styles.description}>
        The publishing editor will live here.
      </p>
    </section>
  );
}
