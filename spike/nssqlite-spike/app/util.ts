export function messageOf(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
        return error.message;
    }
    return String(error);
}

export function stackOf(error: unknown, lines: number): string {
    if (typeof error === 'object' && error !== null && 'stack' in error && typeof error.stack === 'string') {
        return error.stack.split('\n').slice(0, lines).join(' | ');
    }
    return '';
}

export function statement(sql: string, ...params: Array<number | string | null>): [string, Array<number | string | null>] {
    return [sql, params];
}

export type BackendName = 'auto' | 'napi' | 'bridge';

function isBackendName(value: unknown): value is BackendName {
    return value === 'auto' || value === 'napi' || value === 'bridge';
}

/** The bindings to test: globalThis.__NS_BACKENDS__ when the app sets it, otherwise both. */
export function backendsToTest(): BackendName[] {
    const requested = Reflect.get(globalThis, '__NS_BACKENDS__');
    return Array.isArray(requested) ? requested.filter(isBackendName) : ['napi', 'bridge'];
}
