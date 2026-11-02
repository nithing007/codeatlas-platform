/**
 * AddRepositoryForm component.
 * Allows authenticated users to import a public GitHub repository.
 * Performs lightweight client validation, handles submission states,
 * and displays backend error/success messages.
 */

import { useState } from 'react';
import { addRepository } from '../../api/repositories.js';
import { ApiError } from '../../api/client.js';
import { Input } from '../ui/Input.jsx';
import { Button } from '../ui/Button.jsx';
import { Alert } from '../ui/Alert.jsx';
import styles from './AddRepositoryForm.module.css';

export function AddRepositoryForm({ onRepositoryAdded }) {
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clientError, setClientError] = useState('');
  const [serverError, setServerError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const validateUrl = (value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'Repository URL is required.';
    }
    if (!trimmed.includes('/') || trimmed.split('/').filter(Boolean).length < 2) {
      return 'Please enter a valid GitHub repository URL (e.g. https://github.com/owner/repository).';
    }
    return null;
  };

  const handleInputChange = (e) => {
    setUrl(e.target.value);
    if (clientError) setClientError('');
    if (serverError) setServerError('');
    if (successMessage) setSuccessMessage('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const err = validateUrl(url);
    if (err) {
      setClientError(err);
      setServerError('');
      setSuccessMessage('');
      return;
    }

    setClientError('');
    setServerError('');
    setSuccessMessage('');
    setIsSubmitting(true);

    try {
      const response = await addRepository(url.trim());
      setUrl('');
      setSuccessMessage(response.message || 'Repository imported successfully.');
      if (onRepositoryAdded && response.repository) {
        onRepositoryAdded(response.repository);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        setServerError(error.message);
      } else {
        setServerError('An unexpected error occurred while adding the repository.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={styles.formContainer} aria-labelledby="add-repo-title">
      <header className={styles.header}>
        <h2 id="add-repo-title" className={styles.title}>
          Add a Repository
        </h2>
        <p className={styles.subtitle}>
          Enter a public GitHub repository URL to import it for documentation drift detection.
        </p>
      </header>

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        <div className={styles.inputGroup}>
          <div className={styles.inputWrapper}>
            <Input
              id="repository-url-input"
              label="GitHub Repository URL"
              placeholder="https://github.com/owner/repository"
              value={url}
              onChange={handleInputChange}
              error={clientError}
              hint="Format: https://github.com/owner/repository"
              disabled={isSubmitting}
              required
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="md"
            className={styles.submitBtn}
            isLoading={isSubmitting}
            disabled={isSubmitting}
            aria-label="Add repository"
          >
            Add Repository
          </Button>
        </div>

        <div className={styles.feedback}>
          {serverError && (
            <Alert variant="error" role="alert">
              {serverError}
            </Alert>
          )}

          {successMessage && (
            <Alert variant="success" role="alert">
              {successMessage}
            </Alert>
          )}
        </div>
      </form>
    </section>
  );
}
