import EventEmitter from "eventemitter3";
import NDK from "../../index.js";
import { NDKRelay, NDKRelayStatus } from "../index.js";
import debug from "debug";

export type NDKPoolStats = {
    total: number;
    connected: number;
    disconnected: number;
    connecting: number;
};

/**
 * Handles connections to all relays. A single pool should be used per NDK instance.
 *
 * @emit connect - Emitted when all relays in the pool are connected, or when the specified timeout has elapsed, and some relays are connected.
 * @emit notice - Emitted when a relay in the pool sends a notice.
 * @emit flapping - Emitted when a relay in the pool is flapping.
 * @emit relay:connect - Emitted when a relay in the pool connects.
 * @emit relay:disconnect - Emitted when a relay in the pool disconnects.
 */
export class NDKPool extends EventEmitter {
    public relays = new Map<string, NDKRelay>();
    private debug: debug.Debugger;

    public constructor(relayUrls: string[] = [], ndk: NDK) {
        super();
        this.debug = ndk.debug.extend("pool");
        for (const relayUrl of relayUrls) {
            const relay = new NDKRelay(relayUrl);
            relay.on("notice", (relay, notice) => this.emit("notice", relay, notice));
            relay.on("connect", () => this.handleRelayConnect(relayUrl));
            relay.on("disconnect", () => this.emit("relay:disconnect", relay));
            relay.on("flapping", () => this.handleFlapping(relay));
            this.relays.set(relayUrl, relay);
        }
    }

    private handleRelayConnect(relayUrl: string) {
        this.debug(`Relay ${relayUrl} connected`);
        this.emit("relay:connect", this.relays.get(relayUrl));

//        if (this.stats().connected === this.relays.size) {
//            this.emit("connect");
//        }
    }

    /**
     * Attempts to establish a connection to each relay in the pool.
     *
     * @async
     * @param {number} [timeoutMs] - Optional timeout in milliseconds for each connection attempt.
     * @returns {Promise<void>} A promise that resolves when all connection attempts have completed.
     * @throws {Error} If any of the connection attempts result in an error or timeout.
     */
    public async connect(timeoutMs?: number, minConns?:number): Promise<void> {

        this.debug(
            `Connecting to ${this.relays.size} relays${
                timeoutMs ? `, timeout ${timeoutMs}...` : ""
            }`
        );

        const promises = new Map<string, Promise<void> >();
        for (const relay of this.relays.values()) {
            if (timeoutMs) {
                const timeoutPromise = new Promise<void>((_, reject) => {
                    setTimeout(() => reject(`Timed out after ${timeoutMs}ms`), timeoutMs);
                });

                promises.set(relay.url, Promise.race([relay.connect(), timeoutPromise]).catch((e) => {
                    this.debug(`Failed to connect to relay ${relay.url}: ${e}`);
		}));
            } else {
                promises.set(relay.url, relay.connect());
            }
        }

        // If we are running with a timeout, check if we need to emit a `connect` event
        // in case some, but not all, relays were connected
/*	let someTimeout = null;
        if (timeoutMs) {
            someTimeout = setTimeout(() => {
                const allConnected = this.stats().connected === this.relays.size;
                const someConnected = this.stats().connected > 0;

                if (!allConnected && someConnected) {
                    this.emit("connect");
                }
            }, timeoutMs);
        }
*/
	if (!minConns || minConns > this.relays.size)
	    minConns = this.relays.size;

	// wait until minConns have been established,
	// bread if all conn attempts have settled
	while (this.stats().connected < minConns) {
	    let unfulfilled = [];
	    for (const url in promises) {
		if (this.relays.get(url)?.status === NDKRelayStatus.CONNECTING)
		    unfulfilled.push(promises.get(url));
	    }
	    if (unfulfilled.length > 0)
		await Promise.any(unfulfilled);
	    else
		break;
	}

	// if we managed to get anything to connect,
	// notify the client
	if (this.stats().connected > 0)
            this.emit("connect");
    }

    private handleFlapping(relay: NDKRelay) {
        this.debug(`Relay ${relay.url} is flapping`);

        // TODO: Be smarter about this.
        this.relays.delete(relay.url);
        this.emit("flapping", relay);
    }

    public size(): number {
        return this.relays.size;
    }

    /**
     * Returns the status of each relay in the pool.
     * @returns {NDKPoolStats} An object containing the number of relays in each status.
     */
    public stats(): NDKPoolStats {
        const stats: NDKPoolStats = {
            total: 0,
            connected: 0,
            disconnected: 0,
            connecting: 0
        };

        for (const relay of this.relays.values()) {
            stats.total++;
            if (relay.status === NDKRelayStatus.CONNECTED) {
                stats.connected++;
            } else if (relay.status === NDKRelayStatus.DISCONNECTED) {
                stats.disconnected++;
            } else if (relay.status === NDKRelayStatus.CONNECTING) {
                stats.connecting++;
            }
        }

        return stats;
    }

    /**
     * Get a list of all relay urls in the pool.
     */
    public urls(): string[] {
        return Array.from(this.relays.keys());
    }
}
