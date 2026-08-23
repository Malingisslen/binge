/**
 * BIN-931 — every write to the `streamingOffers` collection must address a doc id built by
 * `mediaTypeDocId()` / `streamingOffersDocId()`.
 *
 * WHY A LINT RULE AND NOT A TEST
 * BIN-523 split the doc id from a bare `${tmdbId}` to `${mediaType}_${tmdbId}`, because
 * movie 123 and TV 123 shared one document and showed each other's "where to watch" rows.
 * That failure is invisible — a movie quietly showing a TV show's offers looks like data,
 * not like a bug — so the regression has to be caught structurally.
 *
 * The first structural guard was a set of regexes that scanned `functions/src` as TEXT.
 * Each review round found a shape it could not see and widened it, and each widening opened
 * the next hole: a quote character it did not accept, a character class that stopped at a
 * newline, an optional `db.` that required the dot to touch the identifier, a widening that
 * landed on some of its sites and not the rest. Two shapes were finally left uncovered and
 * merely ASSERTED ABSENT, because no regex can reach them at all:
 *
 *   const c = db.collection('streamingOffers');   // hop 1
 *   const ref = c.doc(String(tmdbId));            // hop 2 — a regex follows one hop
 *   await ref.set({ tmdbId });
 *
 *   batch.set(col.doc(String(tmdbId)), data);     // the ref is an ARGUMENT, not a receiver
 *
 * Both are ordinary Firestore idioms. This rule reads the parse tree and resolves
 * identifiers through ESLint's scope analysis, so a binding chain of any depth and a ref
 * passed as an argument are the same case as the direct one.
 *
 * WHAT IT DOES NOT DO
 * No type information, so an id expression is judged by the syntax that produces it, not by
 * what it evaluates to. An id laundered through something this cannot follow — a reassigned
 * `let`, a function's return value, an object property read off a parameter — is reported
 * rather than trusted. That direction is deliberate: a false positive costs one comment and
 * a false negative costs BIN-523 again.
 */

const COLLECTION = 'streamingOffers';

/**
 * Firestore operations that CREATE or CHANGE a document.
 *
 * `delete` is deliberately absent: retiring a legacy bare doc is how the old ids disappear
 * at all (the refresh cron's `legacyRef.delete()`, the migration's `deleteBare`). A guard
 * that forbade bare ids outright would forbid the only mechanism that removes them.
 */
const WRITE_OPS = new Set(['set', 'update', 'create']);

/** Call expressions whose result is an acceptable doc id. */
const ID_HELPERS = new Set(['mediaTypeDocId', 'streamingOffersDocId']);

/**
 * `BackfillTarget.toId` — built by `targetFor()` with `mediaTypeDocId`, which
 * `backfillIds.test.ts` pins directly. Allowed by NAME because the rule has no types; that
 * is the one laundering step it trusts, and it is trusted because a test owns it.
 */
const ID_CARRIER_PROPS = new Set(['toId']);

const MAX_DEREF_DEPTH = 12;

/** The static name behind `a.b` / `a['b']`, or null when it cannot be read statically. */
function propertyName(member) {
  if (!member || member.type !== 'MemberExpression') return null;
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  if (member.computed && member.property.type === 'Literal' && typeof member.property.value === 'string') {
    return member.property.value;
  }
  return null;
}

function findVariable(scope, name) {
  for (let s = scope; s; s = s.upper) {
    const variable = s.set.get(name);
    if (variable) return variable;
  }
  return null;
}

/**
 * Follow an expression back to the expression it was assigned from, across as many bindings
 * as it takes. Returns the node AND the scope it lives in, because the next hop has to be
 * resolved where IT was written, not where the read happened.
 *
 * A binding written more than once resolves to itself: with two possible values there is no
 * single expression to judge, and guessing one of them is how a guard starts lying.
 */
function deref(node, scope, depth = 0) {
  if (!node || depth > MAX_DEREF_DEPTH) return { node, scope };
  if (node.type === 'TSAsExpression' || node.type === 'TSNonNullExpression') {
    return deref(node.expression, scope, depth + 1);
  }
  if (node.type !== 'Identifier') return { node, scope };

  const variable = findVariable(scope, node.name);
  if (!variable) return { node, scope };
  const writes = variable.references.filter((ref) => ref.writeExpr);
  if (writes.length !== 1) return { node, scope };
  return deref(writes[0].writeExpr, writes[0].from, depth + 1);
}

/** The string a node evaluates to, when that is statically readable. */
function stringValue(node, scope) {
  const { node: n } = deref(node, scope);
  if (!n) return null;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked;
  return null;
}

/** `<anything>.collection('streamingOffers')`, through any number of bindings. */
function isOffersCollection(node, scope) {
  const { node: n, scope: s } = deref(node, scope);
  if (!n || n.type !== 'CallExpression') return false;
  if (propertyName(n.callee) !== 'collection') return false;
  return stringValue(n.arguments[0], s) === COLLECTION;
}

/**
 * A document reference INTO this collection. Returns the id expression (and the scope it
 * lives in) so the caller can judge it, or null when the node is not such a reference.
 */
function offersDocRef(node, scope) {
  const { node: n, scope: s } = deref(node, scope);
  if (!n || n.type !== 'CallExpression') return null;
  if (propertyName(n.callee) !== 'doc') return null;
  if (!isOffersCollection(n.callee.object, s)) return null;
  return { idNode: n.arguments[0] ?? null, scope: s };
}

/** True when the id demonstrably comes from an id helper. */
function isNamespacedId(node, scope) {
  if (!node) return false; // `.doc()` — an auto-generated id is not a namespaced one
  const { node: n } = deref(node, scope);
  if (!n) return false;
  if (n.type === 'CallExpression') {
    const callee = n.callee;
    const name = callee.type === 'Identifier' ? callee.name : propertyName(callee);
    if (name && ID_HELPERS.has(name)) return true;
  }
  if (n.type === 'MemberExpression' && ID_CARRIER_PROPS.has(propertyName(n))) return true;
  return false;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'require every streamingOffers write to address a doc id built by mediaTypeDocId()/streamingOffersDocId()',
    },
    schema: [],
    messages: {
      bareId:
        'This writes to `{{collection}}` with a doc id that does not come from mediaTypeDocId()/streamingOffersDocId(). A movie and a TV show can share the numeric id, so the two titles would share one document and show each other\'s offers (BIN-523). Build the id with the helper.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    function check(candidate, scope, reportNode) {
      if (!candidate) return;
      const ref = offersDocRef(candidate, scope);
      if (!ref) return;
      if (isNamespacedId(ref.idNode, ref.scope)) return;
      context.report({ node: reportNode, messageId: 'bareId', data: { collection: COLLECTION } });
    }

    return {
      CallExpression(node) {
        const op = propertyName(node.callee);
        if (op === null || !WRITE_OPS.has(op)) return;
        const scope = sourceCode.getScope(node);

        // `ref.set(data)` — the ref is the receiver.
        check(node.callee.object, scope, node);
        // `batch.set(ref, data)` / `tx.update(ref, data)` — the ref is the first argument.
        // Checked without identifying the batch/transaction object at all: whatever the
        // receiver is, a doc ref in argument position is about to be written through.
        check(node.arguments[0], scope, node);
      },
    };
  },
};

export default rule;
