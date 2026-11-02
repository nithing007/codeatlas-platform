/**
 * AddRepositoryForm component tests.
 * Verifies validation, submission, duplicate prevention, and error states.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddRepositoryForm } from '../../components/repositories/AddRepositoryForm.jsx';
import * as repositoriesApi from '../../api/repositories.js';
import { ApiError } from '../../api/client.js';

describe('AddRepositoryForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates empty URL input on submit', async () => {
    render(<AddRepositoryForm onRepositoryAdded={vi.fn()} />);

    const submitBtn = screen.getByRole('button', { name: /add repository/i });
    await userEvent.click(submitBtn);

    expect(screen.getByRole('alert')).toHaveTextContent('Repository URL is required.');
  });

  it('validates obviously malformed input', async () => {
    render(<AddRepositoryForm onRepositoryAdded={vi.fn()} />);

    const input = screen.getByLabelText(/github repository url/i);
    await userEvent.type(input, 'not-a-valid-url');

    const submitBtn = screen.getByRole('button', { name: /add repository/i });
    await userEvent.click(submitBtn);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please enter a valid GitHub repository URL'
    );
  });

  it('successfully submits valid URL and clears input', async () => {
    const mockRepo = {
      _id: 'new-repo-id',
      fullName: 'owner/awesome-repo',
    };
    vi.spyOn(repositoriesApi, 'addRepository').mockResolvedValueOnce({
      success: true,
      message: 'Repository imported successfully.',
      repository: mockRepo,
    });

    const handleAdded = vi.fn();
    render(<AddRepositoryForm onRepositoryAdded={handleAdded} />);

    const input = screen.getByLabelText(/github repository url/i);
    await userEvent.type(input, 'https://github.com/owner/awesome-repo');

    const submitBtn = screen.getByRole('button', { name: /add repository/i });
    await userEvent.click(submitBtn);

    expect(repositoriesApi.addRepository).toHaveBeenCalledWith(
      'https://github.com/owner/awesome-repo'
    );
    expect(handleAdded).toHaveBeenCalledWith(mockRepo);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Repository imported successfully.'
    );
    expect(input).toHaveValue('');
  });

  it('prevents duplicate submissions while request is pending', async () => {
    let resolvePromise;
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    vi.spyOn(repositoriesApi, 'addRepository').mockImplementation(() => pendingPromise);

    render(<AddRepositoryForm onRepositoryAdded={vi.fn()} />);

    const input = screen.getByLabelText(/github repository url/i);
    await userEvent.type(input, 'https://github.com/owner/awesome-repo');

    const submitBtn = screen.getByRole('button', { name: /add repository/i });
    await userEvent.click(submitBtn);

    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveAttribute('aria-busy', 'true');

    // Attempt second click while disabled
    await userEvent.click(submitBtn);
    expect(repositoriesApi.addRepository).toHaveBeenCalledTimes(1);

    // Resolve request
    await act(async () => {
      resolvePromise({
        success: true,
        message: 'Done',
        repository: { fullName: 'owner/awesome-repo' },
      });
    });
  });

  it('displays backend duplicate error (409 Conflict)', async () => {
    vi.spyOn(repositoriesApi, 'addRepository').mockRejectedValueOnce(
      new ApiError(
        'Repository "owner/repo" has already been imported into your account.',
        409
      )
    );

    render(<AddRepositoryForm onRepositoryAdded={vi.fn()} />);

    const input = screen.getByLabelText(/github repository url/i);
    await userEvent.type(input, 'https://github.com/owner/repo');

    const submitBtn = screen.getByRole('button', { name: /add repository/i });
    await userEvent.click(submitBtn);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Repository "owner/repo" has already been imported into your account.'
    );
    // Input should NOT be cleared on failure
    expect(input).toHaveValue('https://github.com/owner/repo');
  });

  it('displays backend rate limit error (429)', async () => {
    vi.spyOn(repositoriesApi, 'addRepository').mockRejectedValueOnce(
      new ApiError('GitHub API rate limit exceeded. Please try again shortly.', 429)
    );

    render(<AddRepositoryForm onRepositoryAdded={vi.fn()} />);

    const input = screen.getByLabelText(/github repository url/i);
    await userEvent.type(input, 'https://github.com/owner/repo');

    const submitBtn = screen.getByRole('button', { name: /add repository/i });
    await userEvent.click(submitBtn);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'GitHub API rate limit exceeded. Please try again shortly.'
    );
  });
});
