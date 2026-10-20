import { request as httpsRequest } from 'node:https';
import { PassThrough, Readable } from 'node:stream';
import { MAX_FC_REQUEST_BYTES } from './fc-upload-limits.mjs';

const ENDPOINT = 'https://fcv3.cn-hongkong.aliyuncs.com/2023-03-30/functions/artdicohost-api';
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
    let request, incoming, body, signal, abortListener;
    let failed = false;
    function cleanup() {
      if (abortListener) signal?.removeEventListener('abort', abortListener);
      abortListener = undefined;
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
      if (url !== ENDPOINT || !options || options.method !== 'PUT' || typeof options.body !== 'string'
        || typeof requestFn !== 'function') throw failure();
      const length = Buffer.byteLength(options.body, 'utf8');
      if (length === 0 || length > MAX_FC_REQUEST_BYTES) throw failure();
      // Keep this exported transport as narrow as the client's code-only serializer.
      const prefix = '{"code":{"zipFile":"';
      const suffix = '"}}';
      if (!options.body.startsWith(prefix) || !options.body.endsWith(suffix)) throw failure();
      const encoded = options.body.slice(prefix.length, -suffix.length);
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
      request.end(options.body, 'utf8');
    } catch { fail(); }
  });
  uploadStates.set(promise, state);
  return promise;
}
