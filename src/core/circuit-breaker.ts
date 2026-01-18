import { Logger } from '@nestjs/common';

export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Failing, reject requests
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

export interface CircuitBreakerOptions {
  /** Failure threshold before opening circuit (default: 5) */
  failureThreshold: number;
  /** Success threshold to close circuit (default: 3) */
  successThreshold: number;
  /** Time in ms before trying again (default: 30000) */
  timeout: number;
  /** Time window to count failures in ms (default: 60000) */
  failureWindow: number;
}

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  nextAttemptTime: number | null;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 30000,
  failureWindow: 60000,
};

/**
 * Circuit Breaker implementation for service resilience
 */
export class CircuitBreaker {
  private readonly logger = new Logger(CircuitBreaker.name);
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number | null = null;
  private nextAttemptTime: number | null = null;
  private failureTimestamps: number[] = [];
  private readonly options: CircuitBreakerOptions;

  constructor(
    private readonly serviceName: string,
    options: Partial<CircuitBreakerOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Check if request should be allowed
   */
  canRequest(): boolean {
    this.cleanOldFailures();

    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      // Check if timeout has passed
      if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
        this.logger.log(`Circuit for ${this.serviceName} transitioning to HALF_OPEN`);
        this.state = CircuitState.HALF_OPEN;
        this.successes = 0;
        return true;
      }
      return false;
    }

    // HALF_OPEN - allow limited requests
    return true;
  }

  /**
   * Record a successful request
   */
  onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.logger.log(`Circuit for ${this.serviceName} closing - service recovered`);
        this.reset();
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failures = 0;
    }
  }

  /**
   * Record a failed request
   */
  onFailure(): void {
    const now = Date.now();
    this.failureTimestamps.push(now);
    this.lastFailureTime = now;
    this.failures++;

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open state opens the circuit again
      this.logger.warn(`Circuit for ${this.serviceName} re-opening - failure in HALF_OPEN`);
      this.openCircuit();
    } else if (this.state === CircuitState.CLOSED) {
      this.cleanOldFailures();
      if (this.failureTimestamps.length >= this.options.failureThreshold) {
        this.logger.warn(
          `Circuit for ${this.serviceName} opening - ${this.failureTimestamps.length} failures in window`,
        );
        this.openCircuit();
      }
    }
  }

  /**
   * Get current circuit stats
   */
  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Force reset the circuit
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    this.failureTimestamps = [];
  }

  private openCircuit(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = Date.now() + this.options.timeout;
    this.successes = 0;
  }

  private cleanOldFailures(): void {
    const cutoff = Date.now() - this.options.failureWindow;
    this.failureTimestamps = this.failureTimestamps.filter((t) => t > cutoff);
  }
}

/**
 * Circuit Breaker Manager - manages circuits for multiple services
 */
export class CircuitBreakerManager {
  private readonly circuits = new Map<string, CircuitBreaker>();
  private readonly defaultOptions: Partial<CircuitBreakerOptions>;

  constructor(defaultOptions: Partial<CircuitBreakerOptions> = {}) {
    this.defaultOptions = defaultOptions;
  }

  /**
   * Get or create circuit breaker for a service
   */
  getCircuit(serviceName: string): CircuitBreaker {
    let circuit = this.circuits.get(serviceName);
    if (!circuit) {
      circuit = new CircuitBreaker(serviceName, this.defaultOptions);
      this.circuits.set(serviceName, circuit);
    }
    return circuit;
  }

  /**
   * Check if service request is allowed
   */
  canRequest(serviceName: string): boolean {
    return this.getCircuit(serviceName).canRequest();
  }

  /**
   * Record success for a service
   */
  onSuccess(serviceName: string): void {
    this.getCircuit(serviceName).onSuccess();
  }

  /**
   * Record failure for a service
   */
  onFailure(serviceName: string): void {
    this.getCircuit(serviceName).onFailure();
  }

  /**
   * Get all circuit stats
   */
  getAllStats(): Record<string, CircuitStats> {
    const stats: Record<string, CircuitStats> = {};
    for (const [name, circuit] of this.circuits) {
      stats[name] = circuit.getStats();
    }
    return stats;
  }
}

