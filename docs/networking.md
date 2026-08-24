# MonoRally Networking

MonoRally uses a server-authoritative simulation with client prediction. The design aims to reduce both transmitted data and perceived latency without allowing the client to decide whether a ball was caught.

## Why WebSocket

Browser JavaScript cannot open a raw UDP socket. WebSocket works across current desktop and mobile browsers, HTTPS, Cloudflare Tunnel, reverse proxies, and the PWA build. WebTransport datagrams are a possible future fast path, but using them as the only transport would reduce deployment and browser compatibility.

The source coding theorem describes how much information a noisy channel can carry; it does not remove propagation delay or head-of-line blocking. MonoRally instead sends a small deterministic state, avoids stale queues, synchronizes clocks, and predicts trajectories between authoritative snapshots.

## Clock Synchronization

The client exchanges four NTP-style timestamps:

```text
t0 client send
t1 server receive
t2 server send
t3 client receive
```

Server processing time is removed from the RTT. Each synchronization round sends a coded probe pair with a known departure gap. The client rejects the pair when its server arrival gap reveals queueing or head-of-line distortion, keeps the lower-RTT sample from clean pairs, and uses the median offset of its three lowest-RTT samples.

## Input Packet

Every modern paddle update is nine bytes:

```text
u8  packet type
u16 normalized paddle target
u16 input sequence
u32 synchronized server timestamp
```

Input is sent at up to 60 Hz while moving and at a lower keepalive cadence while stationary. Replaceable movement is not sent when the WebSocket buffer is congested.

## State Packet

The protocol 4 trajectory packet has a 20-byte room header, 12 bytes per active paddle, and 14 bytes per active ball. Paddle state includes position, width, velocity, and the acknowledged input sequence. Ball state contains an ID, flags, quantized position, velocity, and lateral spin acceleration. That is enough for the client to evaluate the same quadratic trajectory between snapshots instead of waiting for each rendered position.

Live rally totals do not ride in every paddle frame. The server writes the scorer's authoritative total into two reserved bytes of the existing hit event, and clients cache it by slot. Roster messages provide a baseline for spectators, reconnects, and late joins. A ball begins scoring only after both sides have touched it, removing the serve receiver's automatic first-point advantage.

Protocol 3 trajectory packets without player scores, protocol 2 binary snapshots, and protocol 1 JSON snapshots remain available for rolling compatibility.

## Collision Adjudication

The ball is tested at the exact swept paddle-contact plane. Human input is evaluated against the synchronized input timeline at that crossing timestamp. A bounded adaptive window accounts for measured one-way delay and jitter; an input generated after the crossing cannot retroactively catch the ball.

This replaces the old wide latency corridor, which could create both false misses and invisible catches. The client speculatively renders a likely bounce while the short authoritative decision is pending, then reconciles to the server result.

## Paddle And Ball Prediction

The local paddle predicts acceleration, maximum speed, and target stopping. Authoritative snapshots gently correct small errors and quickly correct large ones. Ball prediction integrates:

```text
x(t) = x0 + vx*t + 0.5*spin*t^2
y(t) = y0 + vy*t
```

Moving paddle velocity changes the outgoing angle and spin. Spin decays over time and reflects consistently at side walls. The shadow separation follows a vertical arc for depth while the collision position stays exact.

## Network Warning

High RTT, clock jitter, stale snapshots, or a reconnecting socket cause only the affected client's paddle outline and latency badge to pulse red. Other players are not distracted by another device's temporary network fluctuation. An actual disconnect remains part of authoritative room presence and reconnect handling.

## Future Datagram Path

A future WebTransport adapter can send replaceable input and state datagrams while retaining WebSocket for room control, replay, roster, and fallback. The timestamped input timeline and trajectory packet are transport-independent, so that addition would not require rewriting game physics.
