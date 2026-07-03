// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

describe('<Button>', () => {
  it('renders its label and defaults to the primary variant', () => {
    render(<Button>Light it up</Button>);
    const btn = screen.getByRole('button', { name: 'Light it up' });
    expect(btn).toHaveClass('btn', 'btn--primary');
  });

  it('maps each variant to its token-driven class', () => {
    const { rerender } = render(<Button variant="secondary">x</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn--secondary');
    rerender(<Button variant="ghost">x</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn--ghost');
  });

  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>x</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('forwards onClick and extra props', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        x
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    btn.click();
    expect(onClick).not.toHaveBeenCalled(); // disabled swallows the click
  });
});
