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
});
