// Starting positions offered in the sidebar. `path` is the move sequence in SGF coordinates
// ("tt" = pass); `ids` are the matching Josekipedia node ids, used only to prefetch in parallel.

export const JOSEKI = [
    {
        name: '4-4', path: 'pd', ids: [40], children: [
            { name: '3-3 Invasion', path: 'pdqc', ids: [40, 453] },
            {
                name: "Knight's Move Approach", path: 'pdqf', ids: [40, 42], children: [
                    { name: 'Close Pincer', path: 'pdqfqh', ids: [40, 42, 92] },
                    { name: 'Loose Pincer', path: 'pdqfqi', ids: [40, 42, 1182] },
                    { name: 'One-Space High Pincer', path: 'pdqfph', ids: [40, 42, 93] },
                    { name: 'Two-Space High Pincer', path: 'pdqfpi', ids: [40, 42, 94] },
                ],
            },
        ],
    },
    {
        name: '3-4', path: 'qd', ids: [39], children: [
            {
                name: 'One-Space High Approach', path: 'qdod', ids: [39, 84], children: [
                    { name: 'Avalanche', path: 'qdodocpdpcqe', ids: [39, 84, 85, 544, 545, 547] },
                    { name: 'Small Avalanche', path: 'qdodocpdpcqend', ids: [39, 84, 85, 544, 545, 547, 709] },
                    { name: 'Large Avalanche', path: 'qdodocpdpcqencndmd', ids: [39, 84, 85, 544, 545, 547, 713, 714, 715] },
                    { name: 'Magic Sword (1)', path: 'qdodld', ids: [39, 84, 195] },
                    { name: 'Magic Sword (2)', path: 'qdodldqepdpeoe', ids: [39, 84, 195, 1621, 10996, 10997, 10998] },
                ],
            },
            { name: 'Two-Space High Approach', path: 'qdnd', ids: [39, 706] },
            { name: 'Small Enclosure', path: 'qdttoc', ids: [39, 2467, 2555] },
            { name: 'Large Enclosure', path: 'qdttnc', ids: [39, 2467, 2597] },
            { name: 'One-Space High Enclosure', path: 'qdttod', ids: [39, 2467, 2468] },
            { name: 'Two-Space High Enclosure', path: 'qdttnd', ids: [39, 2467, 12624] },
        ],
    },
    { name: '3-5', path: 'qe', ids: [248] },
    { name: '3-3', path: 'qc', ids: [41] },
]

export const FUSEKI = [
    { name: 'Chinese', path: 'pddppqddqk', ids: [40, 35417, 35974, 36237, 58561] },
    { name: 'Mini Chinese', path: 'pddpqpddfqcnkq', ids: [40, 35417, 35470, 36178, 48690, 146105] },
    { name: 'Micro Chinese', path: 'pddpqpddfqcnlq', ids: [40, 35417, 35470, 36178, 48690, 247318] },
    { name: 'Kobayashi', path: 'pddppqddfqcnjp', ids: [40, 35417, 35974, 36237, 39621, 43860, 43861] },
    { name: 'Sanrensei', path: 'pdttppttpj', ids: [40, 2476, 17819, 24535, 49086] },
    { name: 'Orthodox', path: 'pdttqpttoq', ids: [40, 2476, 168642, 168643, 168644] },
]

// When the computer opens on an empty board it picks one of these, as Josekipedia's
// root also lists many unusual first moves.
export const CLASSIC_OPENINGS = ['pd', 'qd', 'qe', 'qc']
