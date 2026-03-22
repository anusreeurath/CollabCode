/**
 * monacoYjsBinding.js
 *
 * A self-contained MonacoBinding that synchronises a Y.Text with a Monaco
 * editor model, and renders remote-user cursors/selections via the Awareness
 * protocol.  Written without importing from 'monaco-editor' directly —
 * Monaco is obtained from the already-mounted editor instance passed in.
 *
 * Usage:
 *   const binding = createMonacoBinding(ytext, editor, awareness);
 *   // ...later, on unmount:
 *   binding.destroy();
 */

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a Monaco ITextModel offset to a { lineNumber, column } position.
 * Mirrors monaco.editor.ITextModel.getPositionAt() — we call it on the model
 * directly instead so we don't need the monaco namespace object.
 */
function offsetToPosition(model, offset) {
  return model.getPositionAt(offset);
}

/**
 * Convert a { lineNumber, column } position back to an absolute offset.
 */
function positionToOffset(model, pos) {
  return model.getOffsetAt(pos);
}

// ─── main factory ─────────────────────────────────────────────────────────────

/**
 * @param {Y.Text}    ytext     - the shared Yjs text type
 * @param {object}    editor    - live Monaco IStandaloneCodeEditor instance
 * @param {object}    awareness - Awareness instance from a Yjs provider
 * @returns {{ destroy: () => void }}
 */
export function createMonacoBinding(ytext, editor, awareness) {
  const model = editor.getModel();
  if (!model) throw new Error('Editor model is not ready');

  // ── flags to prevent re-entrant updates ───────────────────────────────────
  let suppressModelChange = false;
  let suppressYjsChange   = false;

  // ── 1. Initialise Monaco model content from ytext ─────────────────────────
  suppressModelChange = true;
  const initialContent = ytext.toString();
  if (model.getValue() !== initialContent) {
    model.setValue(initialContent);
  }
  suppressModelChange = false;

  // ── 2. Yjs → Monaco  ──────────────────────────────────────────────────────
  const ytextObserver = (event) => {
    if (suppressYjsChange) return;
    suppressModelChange = true;

    let index = 0;
    const edits = [];

    event.delta.forEach((op) => {
      if (op.retain !== undefined) {
        index += op.retain;
      } else if (op.insert !== undefined) {
        const startPos = offsetToPosition(model, index);
        edits.push({
          range: {
            startLineNumber: startPos.lineNumber,
            startColumn:     startPos.column,
            endLineNumber:   startPos.lineNumber,
            endColumn:       startPos.column,
          },
          text: op.insert,
        });
        index += op.insert.length;
      } else if (op.delete !== undefined) {
        const startPos = offsetToPosition(model, index);
        const endPos   = offsetToPosition(model, index + op.delete);
        edits.push({
          range: {
            startLineNumber: startPos.lineNumber,
            startColumn:     startPos.column,
            endLineNumber:   endPos.lineNumber,
            endColumn:       endPos.column,
          },
          text: '',
        });
        // index stays at `index` (characters are removed)
      }
    });

    if (edits.length > 0) {
      model.applyEdits(edits);
    }

    suppressModelChange = false;
  };

  ytext.observe(ytextObserver);

  // ── 3. Monaco → Yjs  ──────────────────────────────────────────────────────
  const modelChangeDisposable = model.onDidChangeContent((e) => {
    if (suppressModelChange) return;
    suppressYjsChange = true;

    ytext.doc.transact(() => {
      // Process changes in reverse order so offsets stay valid
      const changes = [...e.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
      changes.forEach((change) => {
        if (change.rangeLength > 0) {
          ytext.delete(change.rangeOffset, change.rangeLength);
        }
        if (change.text.length > 0) {
          ytext.insert(change.rangeOffset, change.text);
        }
      });
    });

    suppressYjsChange = false;
  });

  // ── 4. Awareness → remote cursors / selections ────────────────────────────
  // We use Monaco's editor decorations API to draw coloured cursor bars and
  // selection highlights for every remote user.
  let decorationIds = [];

  const updateDecorations = () => {
    if (!awareness) return;

    const localId = awareness.clientID;
    const newDecorations = [];

    awareness.getStates().forEach((state, clientId) => {
      if (clientId === localId) return;
      const userInfo = state.user;
      const cursorInfo = state.cursor;
      if (!userInfo || !cursorInfo) return;

      const color = userInfo.color || '#888';
      const name  = userInfo.name  || 'Anonymous';

      // Selection range decoration
      if (
        cursorInfo.anchor !== null &&
        cursorInfo.head   !== null &&
        cursorInfo.anchor !== cursorInfo.head
      ) {
        const from = Math.min(cursorInfo.anchor, cursorInfo.head);
        const to   = Math.max(cursorInfo.anchor, cursorInfo.head);
        const startPos = offsetToPosition(model, from);
        const endPos   = offsetToPosition(model, to);

        newDecorations.push({
          range: {
            startLineNumber: startPos.lineNumber,
            startColumn:     startPos.column,
            endLineNumber:   endPos.lineNumber,
            endColumn:       endPos.column,
          },
          options: {
            className: `yRemoteSelection yRemoteSelection-${clientId}`,
            stickiness: 1, // NeverGrowsWhenTypingAtEdges
          },
        });
      }

      // Cursor position decoration (thin coloured vertical bar)
      if (cursorInfo.head !== null) {
        const cursorPos = offsetToPosition(model, cursorInfo.head);
        newDecorations.push({
          range: {
            startLineNumber: cursorPos.lineNumber,
            startColumn:     cursorPos.column,
            endLineNumber:   cursorPos.lineNumber,
            endColumn:       cursorPos.column,
          },
          options: {
            className: `yRemoteSelectionHead yRemoteSelectionHead-${clientId}`,
            beforeContentClassName: `yRemoteSelectionHead-before yRemoteSelectionHead-before-${clientId}`,
            stickiness: 1,
          },
        });
      }

      // Inject per-user colour into stylesheet if not already present
      injectCursorStyle(clientId, color, name);
    });

    decorationIds = model.deltaDecorations(decorationIds, newDecorations);
  };

  // ── 5. Broadcast our own cursor position to awareness ─────────────────────
  const updateLocalCursor = () => {
    if (!awareness) return;
    const selection = editor.getSelection();
    if (!selection) return;

    const anchor = positionToOffset(model, {
      lineNumber: selection.startLineNumber,
      column:     selection.startColumn,
    });
    const head = positionToOffset(model, {
      lineNumber: selection.endLineNumber,
      column:     selection.endColumn,
    });

    awareness.setLocalStateField('cursor', { anchor, head });
  };

  const cursorDisposable = editor.onDidChangeCursorSelection(updateLocalCursor);

  // Subscribe to remote changes
  const awarenessChangeHandler = () => updateDecorations();
  if (awareness) {
    awareness.on('change', awarenessChangeHandler);
    updateDecorations(); // render any already-known states
    updateLocalCursor(); // broadcast our initial position
  }

  // ── 6. Cleanup ────────────────────────────────────────────────────────────
  function destroy() {
    ytext.unobserve(ytextObserver);
    modelChangeDisposable.dispose();
    cursorDisposable.dispose();
    if (awareness) {
      awareness.off('change', awarenessChangeHandler);
      awareness.setLocalStateField('cursor', null);
    }
    // Remove all decorations
    if (decorationIds.length > 0) {
      model.deltaDecorations(decorationIds, []);
    }
  }

  return { destroy };
}

// ─── per-user CSS injection ───────────────────────────────────────────────────
const injectedStyles = new Set();

function injectCursorStyle(clientId, color, name) {
  const key = `${clientId}-${color}`;
  if (injectedStyles.has(key)) return;
  injectedStyles.add(key);

  const safeColor = color.replace('#', '');
  const id = `yjs-cursor-style-${clientId}`;
  if (document.getElementById(id)) return;

  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    .yRemoteSelection-${clientId} {
      background-color: ${color}40;
    }
    .yRemoteSelectionHead-${clientId} {
      border-color: ${color} !important;
    }
    .yRemoteSelectionHead-before-${clientId}::before {
      content: '${CSS.escape(name)}';
      position: absolute;
      top: -1.4em;
      left: -1px;
      background: ${color};
      color: #fff;
      font-size: 0.68rem;
      font-weight: 700;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
      padding: 1px 5px;
      border-radius: 3px 3px 3px 0;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.45);
      z-index: 99;
    }
  `;
  document.head.appendChild(style);
}
