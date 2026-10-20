import { request as httpsRequest } from 'node:https';
import { PassThrough, Readable } from 'node:stream';
import { MAX_FC_REQUEST_BYTES } from './fc-upload-limits.mjs';

const ENDPOINT = 'https://fcv3.cn-hongkong.aliyuncs.com/2023-03-30/functions/artdicohost-api';
const WRITE_CHUNK_BYTES = 64 * 1024;
const uploadStates = new WeakMap();
const failure = () => new Error('FC upload transport failed; no request or credential details are included');

/** Only promises created here have trusted state; each returned object is a copy. */
export function fcUploadState(promise) {
  const state = uploadStates.get(promise);
  return state ? { uploadBodyWritten: state.uploadBodyWritten, responseStarted: state.responseStarted } : null;
}

/** One fixed, TLS-verified code PUT. finish means locally written, not accepted by FC. */
export function uploadFcCode(url, options, { requestFn = httpsRequest } = {}) {
  const state = { uploadBodyWritten: false, responseStarted: false };
  const promise = new Promise((resolve, reject) => {
    let request, incoming, body, signal, abortListener, payload, drainListener;
    let failed = false, writeStopped = false, offset = 0;
    function stopWriting() {
      writeStopped = true;
      if (drainListener) request?.removeListener('drain', drainListener);
      drainListener = undefined;
    }
    function cleanup() {
      stopWriting();
      if (abortListener) signal?.removeEventListener('abort', abortListener);
      abortListener = undefined;
    }
    function writeBody() {
      if (failed || writeStopped || request.destroyed) return;
      try {
        // The validated wrapper and Base64 are ASCII: each character is one
        // signed UTF-8 byte. Queue one bounded chunk, then honour backpressure.
        while (offset < payload.length) {
          const chunk = payload.slice(offset, offset + WRITE_CHUNK_BYTES);
          offset += chunk.length;
          if (!request.write(chunk, 'utf8')) {
            drainListener = () => { drainListener = undefined; writeBody(); };
            request.once('drain', drainListener);
            return;
          }
        }
        request.end();
      } catch { fail(); }
    }
    function fail() {
      if (failed) return;
      failed = true;
      cleanup();
      const error = failure();
      // Response streams receive only this sanitized error, never socket errors.
      body?.destroy(error);
      incoming?.destroy(error);
      request?.destroy(error);
      reject(error);
    }
    try {
      payload = options?.body;
      if (url !== ENDPOINT || !options || options.method !== 'PUT' || typeof payload !== 'string'
        || typeof requestFn !== 'function') throw failure();
      const length = Buffer.byteLength(payload, 'utf8');
      if (length === 0 || length > MAX_FC_REQUEST_BYTES) throw failure();
      // Keep this exported transport as narrow as the client's code-only serializer.
      const prefix = '{"code":{"zipFile":"';
      const suffix = '"}}';
      if (!payload.startsWith(prefix) || !payload.endsWith(suffix)) throw failure();
      const encoded = payload.slice(prefix.length, -suffix.length);
      if (!encoded.length || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw failure();
      const headers = new Headers(options.headers);
      if (!/^application\/json(?:\s*;|$)/iu.test(headers.get('content-type') ?? '')
        || headers.has('transfer-encoding') || headers.has('upgrade')
        || headers.has('host') && headers.get('host') !== 'fcv3.cn-hongkong.aliyuncs.com'
        || headers.has('content-length') && headers.get('content-length') !== String(length)) throw failure();
      headers.set('content-length', String(length));
      signal = options.signal;
      if (signal !== undefined && !(signal instanceof AbortSignal)) throw failure();
      if (signal?.aborted) throw failure();
      abortListener = fail;
      signal?.addEventListener('abort', abortListener, { once: true });
      request = requestFn(ENDPOINT, { method: 'PUT', headers: Object.fromEntries(headers), rejectUnauthorized: true }, response => {
        // An early response must not release any waiting upload chunks. Its
        // existing bounded response path closes an unfinished PUT on completion.
        stopWriting();
        state.responseStarted = true;
        incoming = response;
        response.on('error', fail);
        response.on('aborted', fail);
        if (failed) { response.destroy(); return; }
        try {
          const responseHeaders = new Headers();
          for (let index = 0; index < response.rawHeaders.length; index += 2) responseHeaders.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
          if ([204, 205, 304].includes(response.statusCode)) {
            response.on('end', () => {
              if (!request.writableFinished) request.destroy();
              cleanup();
            });
            response.resume();
            resolve(new Response(null, { status: response.statusCode, headers: responseHeaders }));
            return;
          }
          // pipe preserves backpressure while preventing raw network errors from
          // reaching the web body. The caller retains its existing read-size cap.
          body = new PassThrough({
            destroy(error, done) {
              // Stop queued flowing reads synchronously before toWeb closes its
              // controller; delayed source chunks must not reach a cancelled body.
              this.pause();
              response.unpipe(this);
              if (!this.readableEnded) { response.destroy(); request.destroy(); }
              else if (!request.writableFinished) request.destroy();
              done(error);
            },
          });
          body.on('error', () => {});
          body.on('close', () => {
            cleanup();
            if (!body.readableEnded) { response.destroy(); request.destroy(); }
          });
          const result = new Response(Readable.toWeb(body), { status: response.statusCode, headers: responseHeaders });
          response.pipe(body);
          resolve(result);
        } catch { fail(); }
      });
      request.on('error', fail);
      request.on('finish', () => {
        // Destroying an unfinished request can release buffered write callbacks
        // and emit finish; discarded bytes must not become successful progress.
        if (!request.destroyed) state.uploadBodyWritten = true;
      });
      request.on('upgrade', (_response, socket) => { socket.destroy(); fail(); });
      request.once('close', stopWriting);
      writeBody();
    } catch { fail(); }
  });
  uploadStates.set(promise, state);
  return promise;
}
