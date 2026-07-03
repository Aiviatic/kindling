// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextInput } from './TextInput';

describe('<TextInput>', () => {
  it('associates the always-visible label with the input (a11y floor)', () => {
    render(<TextInput label="Project name" placeholder="my-app" />);
    // getByLabelText resolves only via real label↔input association (htmlFor/id), not placeholder.
    const input = screen.getByLabelText('Project name');
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('placeholder', 'my-app');
  });

  it('honors an explicit id but still wires the label to it', () => {
    render(<TextInput label="Folder" id="dest" />);
    expect(screen.getByLabelText('Folder')).toHaveAttribute('id', 'dest');
  });

  it('forwards value/onChange and other input props', () => {
    render(<TextInput label="Name" value="kindling" readOnly />);
    expect(screen.getByLabelText('Name')).toHaveValue('kindling');
  });
});
