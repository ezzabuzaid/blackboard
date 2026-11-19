import assert from 'node:assert/strict';
import test from 'node:test';

import { type LoaderFunctionArgs, RouterContextProvider } from 'react-router';

import { loader } from './index.tsx';

function loaderArgs(request: Request): LoaderFunctionArgs {
  return {
    request,
    url: new URL(request.url),
    pattern: '',
    params: {},
    context: new RouterContextProvider(),
  };
}

function sessionFetch(session: Response): typeof fetch {
  return async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/api/auth/get-session')) return session;
    return new Response(null, { status: 404 });
  };
}

test('a signed-in visitor goes on to the page they asked for', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = sessionFetch(Response.json({ user: { id: 'user-1' } }));
  const request = new Request(
    'http://localhost/login?redirect=%2Fgroups%2Fnew%3Ftemplate%3Dfounder-board',
  );

  try {
    await assert.rejects(loader(loaderArgs(request)), (error: unknown) => {
      assert.ok(error instanceof Response);
      assert.equal(
        error.headers.get('location'),
        '/groups/new?template=founder-board',
      );
      assert.equal(error.headers.get('X-Remix-Replace'), 'true');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a signed-in visitor is not sent to another site', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = sessionFetch(Response.json({ user: { id: 'user-1' } }));
  const request = new Request(
    'http://localhost/login?redirect=%2F%2Fevil.example',
  );

  try {
    await assert.rejects(loader(loaderArgs(request)), (error: unknown) => {
      assert.ok(error instanceof Response);
      assert.equal(error.headers.get('location'), '/');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a signed-in visitor with a backslash return path stays on the origin', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = sessionFetch(Response.json({ user: { id: 'user-1' } }));
  const request = new Request(
    'http://localhost/login?redirect=%2F%5Cevil.example',
  );

  try {
    await assert.rejects(loader(loaderArgs(request)), (error: unknown) => {
      assert.ok(error instanceof Response);
      assert.equal(error.headers.get('location'), '/\\evil.example');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a visitor without a session sees the sign-in page', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = sessionFetch(Response.json(null));

  try {
    assert.equal(
      await loader(
        loaderArgs(new Request('http://localhost/login?redirect=%2Fgroups')),
      ),
      null,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the sign-in page still opens when the session cannot be read', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = sessionFetch(new Response(null, { status: 503 }));

  try {
    assert.equal(
      await loader(loaderArgs(new Request('http://localhost/login'))),
      null,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
