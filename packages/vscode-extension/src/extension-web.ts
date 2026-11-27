import type * as vscode from 'vscode';
import { activate, deactivate } from './extension';

// Web extensions load as a CommonJS worker script, which expects the
// activation functions on `exports` rather than ES module exports.
declare const exports: {
  activate: (context: vscode.ExtensionContext) => Promise<void>;
  deactivate: () => void;
};

exports.activate = activate;
exports.deactivate = deactivate;
