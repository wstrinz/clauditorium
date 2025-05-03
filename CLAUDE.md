## Svelte 4 to Svelte 5

We are running Svelte 5, but your knowledge cutoff likely only includes Svelte 4. Here is a summary of the differences:

Note that new rune features can only be used in .svelte or .svelte.ts / .svelte.js files, so if you plan to use runes in a plain js/ts file make sure to include the .svelte part.

Make sure to use the new syntaxes for event handling (`onclick` vs `on:click`)

### Reactivity with Runes

- `let` → `$state(...)`: Variables are only reactive if wrapped in `$state`.
- `$:` derived values → `$derived(...)`: Computed values must explicitly use `$derived`
  - derived values are called like functions when you reference them (`derivedValue()`)
  - you cannot assign to a derived state
- `$:` side effects → `$effect(...)`: Side effects no longer share syntax with derived values.
  - `$effect` can only be used inside an effect (e.g. during component initialisation)

Note: If your `$:` line mixed computations and side effects, you must now separate them. For statements that can’t be cleanly translated, you might see `run()` from `svelte/legacy` inserted by the migration script. You’ll need to manually refactor those.

You **do not** need to import runes, they're available by default.

When persisting `$state` runes to the DB, you should send snapshots using `$state.snapshot` to get a defined value while still in a svelte file.

### Props and Exported Variables

- Replace `export let x` with `let { x } = $props()`.
- Renaming or handling unknown props is done with destructuring.
- No more `$$restProps` or `$$props`; just spread the object returned by `$props()`.

Note: `children` is now a reserved prop. You cannot name a prop `children`. Instead, consider renaming it or accessing children content through `$props()` and `{@render children()}`.

### Events

- `on:click` → `onclick` (just a property, no directive).
- No event modifiers (e.g. `|preventDefault`) inline. Implement logic in the handler or via a wrapper function.
- To combine multiple handlers, call them manually inside a single `onclick`.
- Component events now use callback props instead of `createEventDispatcher`.

Note: Some events like `wheel` and `touchstart` become passive by default. If you used modifiers to prevent scrolling, you’ll need to re-implement that logic in an action or a custom event handler setup.

### Snippets Instead of Slots

- `<slot />` → `{@render children()}`
- Named slots: `<slot name="header" />` → `{@render header()}`
- Passing data back up via snippets: Use `{#snippet name(arg)}` blocks instead of `let:` syntax in slots.

Note: While mixing old slots and new snippets is supported, it can be confusing. Make sure you fully understand how `{@render ...}` calls correspond to snippet props. For advanced patterns, carefully test that snippet data flows as expected.

### Components No Longer Classes

- Instantiate components with `mount(App, { target, props })`.
- `$on`, `$set`, `$destroy` methods are replaced by:
  - Events via `events: { eventName: callback }` when calling `mount()`.
  - `$state()` for dynamically updating props.
  - `unmount()` to remove components.

Note: In legacy code, you might rely on `$on` or `$set` after instantiation. Now you must plan your data flow from the start, using `$state` for reactivity and passing event callbacks upfront. If needed, `createClassComponent` from `svelte/legacy` can restore the old API, but it’s a temporary workaround.

### Server-Side Rendering

- `render(App, { props })` replaces `App.render()`.
- CSS no longer included by default in server output. Use compiler options or external tooling.

Note: If you rely on the old inline CSS in server output, you must switch to injected CSS or let your bundler handle CSS. Keep in mind comments used for hydration are now critical and shouldn’t be removed.

### Whitespace and HTML Structure

- Whitespace is more aggressively normalized.
- Strict HTML validation: elements like `<table>` require proper `<tbody>` explicitly.

Note: If your templates rely on browser DOM “fixes,” you must now provide correct semantic HTML or face compile errors.

### Modern Browser Requirement

- No IE support.
- Proxies and `ResizeObserver` are used by default.

Note: If supporting older browsers was part of your flow, you must introduce polyfills or reconsider your supported browsers.

### Compiler Options and Behavior

- `immutable`, `accessors`, `hydratable` options no longer work as before.
- `children` prop is reserved.
- `<foo.bar>` is now interpreted as a component reference, not a literal tag.

Note: Certain options or patterns you relied on (like `accessors`) may now be ignored. If your code depended on these features, rewrite those parts.

### Bindings and Reactivity

- Bindable props must be explicitly marked with `$bindable()`.
- Bindings to component exports are not allowed; use `bind:this` and access exports from the instance.

Note: If you had patterns like `<Child bind:someProp />` for every prop, you must now explicitly mark them as bindable. Otherwise, the compiler will complain.

### Lifecycle Hooks

- `beforeUpdate` and `afterUpdate` do not exist in runes mode; replace with `$effect.pre()` or `$effect()` calls.
- `$effect.pre()` runs before DOM updates, `$effect()` after.

Note: Refactoring your lifecycle hooks requires careful timing adjustments. `$effect()` doesn’t run on the server, whereas `$:` statements once did, so behavior may differ. Test your SSR scenarios carefully.

### Hydration Differences

- Svelte 5 uses comments to guide hydration; removing them breaks hydration.
- Mismatches in `src` or `{@html ...}` during hydration no longer trigger automatic reloading or HTML resets.

Note: If SSR output differs from client props, you must manually reconcile. This can mean setting values to `undefined` on mount and reassigning after `$effect()` runs.

### Miscellaneous

- `null` and `undefined` print as empty strings, not "null"/"undefined".
- Content within `<svelte:options>` is forbidden.
- `<svelte:element this="div">` is disallowed; `<div>` is preferred. If dynamic, use an expression: `<svelte:element this={expr}>`.
- Transitions now run by default on mount; set `intro: false` if you don’t want them.
- `bind:files` now strictly accepts `null`, `undefined`, or a `FileList`.

Note: Check any logic expecting `null` or `undefined` to print literally. Make sure your code doesn’t rely on old stringified values. Also, ensure that `bind:files` usage aligns with the new two-way binding expectations.
