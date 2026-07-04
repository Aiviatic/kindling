// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Intro } from './Intro';

describe('<Intro>', () => {
  it('states the plan and advances on "Let\'s go"', () => {
    const onContinue = vi.fn();
    render(<Intro onContinue={onContinue} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    screen.getByRole('button', { name: "Let's go" }).click();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('offers Cancel only when onCancel is provided, and calls it', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<Intro onContinue={vi.fn()} />);
    // No cancel affordance without the handler (the screen still renders standalone).
    expect(screen.queryByRole('button', { name: 'Cancel setup' })).not.toBeInTheDocument();

    rerender(<Intro onContinue={vi.fn()} onCancel={onCancel} />);
    screen.getByRole('button', { name: 'Cancel setup' }).click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
