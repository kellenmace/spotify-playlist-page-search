## Coding guidelines

- Use snake_case for all variables, functions, methods, and properties.
- Name all React Components and classes using PascalCase
- Use hyphens between words in multi-word filenames (e.g. `magic-link.ts`).
- Prefer function definitions over function expressions.
- Prefer using a functional programming approach rather than an object oriented approach. Avoid using JavaScript classes unless multiple instances of something need to be created and it makes sense to do so.
- When modifying the imports at the top of a file, order them so that imports for third-party libraries come first, then imports for local files.
- Organize code using a top-down function call chain: define higher-level functions first, followed by the lower-level helper functions they call.
- Do not use JSDoc to document the functions you create or modify. If the purpose of a function can be easily understood by reading the code, then there is no need to add documentation. If the purpose of a function cannot be easily understood by reading the code, then add documentation using a few lines of inline comments (`//` syntax).
- Instead of `Array.from(arrayLike)`, use `[...arrayLike]` spread syntax.
- Do not declare multiple variables on the same line.
- Prefer whole words in variable and property names such as `response` rather than `res`.
- Only create classes when multiple instances of the class need to be created or there is another compelling reason to do so. Otherwise, prefer using simple functions.
- Use Boolean(value) instead of !!value when converting expressions to booleans for clarity and readability.
- Use async/await instead of Promises.
