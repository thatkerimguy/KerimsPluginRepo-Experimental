const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

export async function resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !HAS_EXTENSION.test(specifier)) {
        try {
            return await next(`${specifier}.ts`, context);
        } catch { }
    }
    return next(specifier, context);
}
