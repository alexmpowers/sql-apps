import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { connectionFileStore } from '../src/storage.js';

test('Blob SDK listing reads one bounded page and preserves its opaque continuation', async t => {
  const prefix = 'fixture-tenant/fixture-user/';
  const continuationToken = 'opaque + / marker';
  const requests: URL[] = [];
  const blob = (index: number) => `<Blob><Name>${prefix}file-${index}.txt</Name><Properties><Content-Length>${index}</Content-Length><BlobType>BlockBlob</BlobType></Properties></Blob>`;
  const server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://fixture.invalid');
    requests.push(url);
    const second = url.searchParams.get('marker') === continuationToken;
    const entries = second ? blob(101) : Array.from({ length: 100 }, (_, index) => blob(index + 1)).join('');
    response.writeHead(200, { 'content-type': 'application/xml', 'x-ms-request-id': 'fixture-request', 'x-ms-version': '2025-11-05' });
    response.end(`<?xml version="1.0" encoding="utf-8"?>
      <EnumerationResults ServiceEndpoint="http://127.0.0.1/" ContainerName="files">
        <Prefix>${prefix}</Prefix><Delimiter>/</Delimiter><MaxResults>100</MaxResults>
        <Blobs>${entries}${second ? `<BlobPrefix><Name>${prefix}.snapshots/</Name></BlobPrefix>` : ''}</Blobs>
        <NextMarker>${second ? '' : continuationToken}</NextMarker>
      </EnumerationResults>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}/fixturestorage`;
  const key = Buffer.alloc(32).toString('base64');
  const store = connectionFileStore(`DefaultEndpointsProtocol=http;AccountName=fixturestorage;AccountKey=${key};BlobEndpoint=${endpoint}`, 'files');
  assert.ok(store.list);
  const first = await store.list(prefix, { maxPageSize: 100 });
  assert.deepEqual(first.files, Array.from({ length: 100 }, (_, index) => ({ name: `file-${index + 1}.txt`, size: index + 1 })));
  assert.equal(first.continuationToken, continuationToken);
  assert.equal(requests.length, 1, 'listing must not prefetch the second page');
  const second = await store.list(prefix, { maxPageSize: 100, continuationToken: first.continuationToken });
  assert.deepEqual(second, { files: [{ name: 'file-101.txt', size: 101 }] });
  assert.equal(requests.length, 2);
  assert.equal(requests[1]!.searchParams.get('marker'), continuationToken);
  for (const request of requests) {
    assert.equal(request.pathname, '/fixturestorage/files');
    assert.equal(request.searchParams.get('comp'), 'list');
    assert.equal(request.searchParams.get('prefix'), prefix);
    assert.equal(request.searchParams.get('delimiter'), '/');
    assert.equal(request.searchParams.get('maxresults'), '100');
  }
});
