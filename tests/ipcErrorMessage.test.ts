/**
 * Tests for ipcErrorMessage (src/renderer/api.ts): stripping Electron's
 * "Error invoking remote method" wrapper from errors thrown by IPC handlers.
 */
import { describe, it, expect } from 'vitest';
import { ipcErrorMessage } from '../src/renderer/api';

describe('ipcErrorMessage', () => {
  it('strips the wrapper and a plain Error prefix', () => {
    const err = new Error("Error invoking remote method 'search-folder': Error: Advanced search query failed");
    expect(ipcErrorMessage(err)).toBe('Advanced search query failed');
  });

  it('strips a custom error-class prefix', () => {
    const err = new Error("Error invoking remote method 'search-folder': AdvancedQuerySyntaxError: Invalid advanced search query: Unexpected token");
    expect(ipcErrorMessage(err)).toBe('Invalid advanced search query: Unexpected token');
  });

  it('keeps a colon-containing message that has no error-class prefix', () => {
    const err = new Error("Error invoking remote method 'x': Invalid advanced search query: bad");
    expect(ipcErrorMessage(err)).toBe('Invalid advanced search query: bad');
  });

  it('leaves messages that did not come through IPC unchanged', () => {
    expect(ipcErrorMessage(new Error('plain failure'))).toBe('plain failure');
    expect(ipcErrorMessage('a string')).toBe('a string');
  });
});
