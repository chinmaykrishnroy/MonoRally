/**
 * Abstract EventBus interface for MonoRally inter-service messaging.
 * Facilitates low-latency communication between Gateways, Workers, and Matchmaker.
 */
export class EventBus {
  /**
   * Publishes a message to a subject.
   * @param {string} subject - Destination subject (e.g., 'room.ABCD.input')
   * @param {Uint8Array|Buffer|string|object} data - Message payload
   * @param {string} [replyTo] - Optional reply inbox subject
   */
  async publish(subject, data, replyTo = undefined) {
    throw new Error("publish() not implemented");
  }

  /**
   * Subscribes to a subject or wildcard pattern.
   * @param {string} subject - Subject pattern ('*' matches single token, '>' matches multi token)
   * @param {function(data: Uint8Array|object|string, replyTo?: string, subject?: string): void} handler
   * @param {object} [options] - Subscription options (e.g. { queue: 'queue-group' })
   * @returns {Promise<{ unsubscribe: function(): void }>}
   */
  async subscribe(subject, handler, options = {}) {
    throw new Error("subscribe() not implemented");
  }

  /**
   * Performs a request-reply RPC call.
   * @param {string} subject - Request destination
   * @param {Uint8Array|Buffer|string|object} data - Request payload
   * @param {number} [timeoutMs=2000] - Timeout in milliseconds
   * @returns {Promise<any>}
   */
  async request(subject, data, timeoutMs = 2000) {
    throw new Error("request() not implemented");
  }

  /**
   * Closes the bus connection and releases resources.
   */
  async close() {
    throw new Error("close() not implemented");
  }
}
