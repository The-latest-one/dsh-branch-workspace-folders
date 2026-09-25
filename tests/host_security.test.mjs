import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidSessionId, isLoopback, isLoopbackHost, isTrustedBrowserRequest } from '../lib/index.js'

test('isValidSessionId allows valid DSH session identifiers', () => {
  assert.equal(isValidSessionId('session-3f85b07e40fb'), true)
  assert.equal(isValidSessionId('12345'), true)
  assert.equal(isValidSessionId('sess_abc-DEF_01'), true)
})

test('isValidSessionId rejects path traversal and invalid characters', () => {
  assert.equal(isValidSessionId(''), false)
  assert.equal(isValidSessionId('../traversal'), false)
  assert.equal(isValidSessionId('..'), false)
  assert.equal(isValidSessionId('a/b'), false)
  assert.equal(isValidSessionId('a\\b'), false)
  assert.equal(isValidSessionId('a b'), false)
  assert.equal(isValidSessionId('a;rm -rf'), false)
  assert.equal(isValidSessionId('a'.repeat(129)), false)
  assert.equal(isValidSessionId(null), false)
  assert.equal(isValidSessionId(undefined), false)
  assert.equal(isValidSessionId(123), false)
})

test('isLoopback accepts only loopback IPv4 and IPv6 addresses', () => {
  assert.equal(isLoopback('127.0.0.1'), true)
  assert.equal(isLoopback('127.0.0.2'), true)
  assert.equal(isLoopback('::1'), true)
  assert.equal(isLoopback('::1%lo0'), true)
  assert.equal(isLoopback('::ffff:127.0.0.1'), true)

  assert.equal(isLoopback('192.168.1.1'), false)
  assert.equal(isLoopback('10.0.0.1'), false)
  assert.equal(isLoopback('172.17.0.1'), false)
  assert.equal(isLoopback('8.8.8.8'), false)
  assert.equal(isLoopback(''), false)
  assert.equal(isLoopback(undefined), false)
})

test('isLoopbackHost validates loopback authorities and rejects external domains', () => {
  assert.equal(isLoopbackHost('localhost'), true)
  assert.equal(isLoopbackHost('localhost:3080'), true)
  assert.equal(isLoopbackHost('127.0.0.1'), true)
  assert.equal(isLoopbackHost('127.0.0.1:3080'), true)
  assert.equal(isLoopbackHost('[::1]'), true)
  assert.equal(isLoopbackHost('[::1]:3080'), true)

  assert.equal(isLoopbackHost('evil.com'), false)
  assert.equal(isLoopbackHost('evil.com:3080'), false)
  assert.equal(isLoopbackHost('192.168.1.1:3080'), false)
  assert.equal(isLoopbackHost(''), false)
})

test('isTrustedBrowserRequest blocks CSRF and cross-site browser requests', () => {
  // Same-origin browser request
  assert.equal(
    isTrustedBrowserRequest({
      headers: {
        host: '127.0.0.1:3080',
        origin: 'http://127.0.0.1:3080',
        'sec-fetch-site': 'same-origin',
      },
    }),
    true,
  )

  // Non-browser or direct API call without origin
  assert.equal(
    isTrustedBrowserRequest({
      headers: {
        host: '127.0.0.1:3080',
      },
    }),
    true,
  )

  // Block cross-site marker
  assert.equal(
    isTrustedBrowserRequest({
      headers: {
        host: '127.0.0.1:3080',
        origin: 'http://127.0.0.1:3080',
        'sec-fetch-site': 'cross-site',
      },
    }),
    false,
  )

  // Block DNS Rebinding (attacker host header)
  assert.equal(
    isTrustedBrowserRequest({
      headers: {
        host: 'evil.com:3080',
        origin: 'http://evil.com:3080',
        'sec-fetch-site': 'same-origin',
      },
    }),
    false,
  )

  // Block mismatched origin (attacker site)
  assert.equal(
    isTrustedBrowserRequest({
      headers: {
        host: '127.0.0.1:3080',
        origin: 'http://evil.com',
        'sec-fetch-site': 'same-site',
      },
    }),
    false,
  )

  // Block malformed origin URL
  assert.equal(
    isTrustedBrowserRequest({
      headers: {
        host: '127.0.0.1:3080',
        origin: 'invalid-url',
      },
    }),
    false,
  )
})
