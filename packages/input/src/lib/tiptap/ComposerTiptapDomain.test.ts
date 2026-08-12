import { getSchema } from '@tiptap/core';
import { DOMSerializer, DOMParser as PMDOMParser } from '@tiptap/pm/model';
import type { Schema } from '@tiptap/pm/model';
import { expect, it } from 'vitest';

import { createComposerTiptapExtensions } from './ComposerTiptapDomain';

function composerSchema() {
  return getSchema(
    createComposerTiptapExtensions({
      getRemoteImageCount: () => 0,
      getMentionTrigger: () => '@',
    }),
  );
}

function roundTripThroughHtml(schema: Schema, content: unknown) {
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [{ type: 'paragraph', content: [content] }],
  });
  const container = document.createElement('div');
  container.appendChild(
    DOMSerializer.fromSchema(schema).serializeFragment(doc.content),
  );
  return {
    html: container.innerHTML,
    doc: PMDOMParser.fromSchema(schema).parse(container),
  };
}

function firstNodeOfType(
  doc: ReturnType<typeof roundTripThroughHtml>['doc'],
  typeName: string,
) {
  let found: Record<string, unknown> | null = null;
  doc.descendants((node) => {
    if (!found && node.type.name === typeName) {
      found = node.attrs;
    }
  });
  return found;
}

function mention(attrs: Record<string, unknown>) {
  return {
    type: 'composerMention',
    attrs: {
      id: 'm1',
      trigger: '@',
      value: 'report.csv',
      label: '@report.csv',
      detail: 'file',
      ...attrs,
    },
  };
}

it('round-trips an object payload through HTML', () => {
  const schema = composerSchema();
  const payload = { path: '/Users/ezz/report.csv', type: 'file' };

  const { doc } = roundTripThroughHtml(schema, mention({ payload }));

  expect(firstNodeOfType(doc, 'composerMention')).toMatchObject({ payload });
});

it('round-trips the persisted form through HTML', () => {
  const schema = composerSchema();
  const persistsAs = '[$revenue](skill://revenue)';

  const { doc } = roundTripThroughHtml(schema, mention({ persistsAs }));

  expect(firstNodeOfType(doc, 'composerMention')).toMatchObject({
    persistsAs,
  });
});

it('round-trips an absent payload as null through HTML', () => {
  const schema = composerSchema();

  const { html, doc } = roundTripThroughHtml(schema, mention({}));

  expect(html).not.toContain('payload=');
  expect(firstNodeOfType(doc, 'composerMention')).toMatchObject({
    payload: null,
  });
});

it('keeps a numeric-looking value a string through HTML', () => {
  const schema = composerSchema();

  const { doc } = roundTripThroughHtml(
    schema,
    mention({ value: '2024', label: '@2024' }),
  );

  expect(firstNodeOfType(doc, 'composerMention')).toMatchObject({
    value: '2024',
  });
});

it('keeps a slash-command mark through an HTML round trip', () => {
  const schema = composerSchema();

  const { doc } = roundTripThroughHtml(schema, {
    type: 'text',
    text: '/prompts:audit',
    marks: [
      {
        type: 'composerSlashCommand',
        attrs: { value: 'prompts:audit', detail: 'Audit the schema' },
      },
    ],
  });

  let marks: string[] = [];
  doc.descendants((node) => {
    if (node.isText) {
      marks = node.marks.map((mark) => mark.type.name);
    }
  });

  expect(marks).toContain('composerSlashCommand');
});
