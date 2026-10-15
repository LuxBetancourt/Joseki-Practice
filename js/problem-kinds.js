// The problem types, in the order they're listed. Everything that lists them takes it from here.
//
// Adding a type also takes: its generator (and its cases in problemData, rebuildProblem,
// problemAt and, if a link needs more than its moves, compactData/decodeProblem) in problems.js;
// its checkbox in index.html; its [data-kind] color in index.css; and its entry on about.html.
// test/problem-kinds.test.mjs checks those are all there.
//
//   name:       shown to the player
//   goal:       shown on the banner that introduces each problem
//   code:       its letter in problem links (see encodeProblem); never change a type's letter, or
//               links already shared stop working
//   answeredBy: 'move'    a move on the board (Next Move, Punish)
//               'line'    a whole line played on the board, one move at a time (Final Shape,
//                         Play for Sente): problem.step counts how far it has got
//               'cards'   picking one of the sequences shown in place of the board (Pick the Path)
//               'buttons' the buttons below the board (choices: [value, label] for each)
//   solved:     the problem bar's message once it's solved (default: keep playing)

export const PROBLEM_KINDS = {
    next: { name: 'Next Move', goal: 'Find the joseki move', code: 'n', answeredBy: 'move' },
    punish: { name: 'Punish', goal: 'Punish the mistake', code: 'p', answeredBy: 'move' },
    shape: { name: 'Final Shape', goal: 'Play out the faded shape', code: 's', answeredBy: 'line', solved: 'Solved! That’s the final shape.' },
    path: { name: 'Pick the Path', goal: 'Pick the joseki sequence', code: 'l', answeredBy: 'cards', solved: 'Solved! That’s the joseki.' },
    better: {
        name: 'Who’s Better?', goal: 'Judge the position', code: 'b', answeredBy: 'buttons', solved: 'Correct!',
        choices: [['black', 'Black is better'], ['even', 'Even'], ['white', 'White is better']],
    },
    tenuki: {
        name: 'Tenuki-able?', goal: 'Can you play elsewhere?', code: 't', answeredBy: 'buttons', solved: 'Correct!',
        choices: [['yes', 'Tenuki is fine'], ['no', 'Must play locally']], // Shown with a stone of the side asked about
    },
    sente: { name: 'Play for Sente', goal: 'End the joseki with sente', code: 'e', answeredBy: 'line', solved: 'Solved! You end in sente.' },
}

export const KINDS = Object.keys(PROBLEM_KINDS)

/** An object with an entry per type, made by `f(kind's entry, kind)`. */
export const byKind = (f) => Object.fromEntries(KINDS.map((kind) => [kind, f(PROBLEM_KINDS[kind], kind)]))
