import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App.tsx';
import { eventConfig } from './config/index.ts';

describe('App shell', () => {
  it('renders the event name as the page heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(eventConfig.eventName);
  });

  it('shows the instruction and privacy message', () => {
    render(<App />);
    expect(screen.getByText(eventConfig.instruction)).toBeInTheDocument();
    expect(screen.getByText(eventConfig.privacyMessage)).toBeInTheDocument();
  });
});
