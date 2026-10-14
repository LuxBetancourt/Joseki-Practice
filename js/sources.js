// The books Josekipedia cites, by the codes in its data (from its own list, josekipedia.com/lang/sources.js),
// with their Sensei's Library pages where there is one.

const BOOKS = {
    '100tips': ['100 Tips for Amateur Players 1', '100TipsForAmateurPlayersI'],
    '100tips2': ['100 Tips for Amateur Players 2', '100TipsForAmateurPlayersII'],
    dobj21: ['21st Century Dictionary of Basic Joseki', ''],
    '21st': ['21st Century New Openings', '21stCenturyNewOpenings'],
    '38bj': ['38 Basic Joseki', '38BasicJoseki'],
    ctp: ['A Compendium of Trick Plays', 'ACompendiumOfTrickPlays'],
    aaj: ['All About Joseki', 'AllAboutJoseki'],
    afg: ['Appreciating Famous Games', 'AppreciatingFamousGames'],
    cosmic: ['Cosmic Go: A Guide to Four-Stone Handicap Games', 'CosmicGo'],
    dobj: ['Dictionary of Basic Joseki', 'DictionaryOfBasicJoseki'],
    eoj: ['Encyclopedia of Joseki', 'GendaiJosekiJiten'],
    ej: ['Essential Joseki', 'EssentialJoseki'],
    jiot: ['Jungsuk in Our Time', 'JungsukInOurTime'],
    ksob: ['Korean Style of Baduk', 'KoreanStyleOfBaduk'],
    mgs: ['Making Good Shape', 'MakingGoodShape'],
    mjf1: ['Modern Joseki and Fuseki, Volume 1', 'ModernJosekiAndFusekiVol1'],
    mjf2: ['Modern Joseki and Fuseki, Volume 2', 'ModernJosekiAndFusekiVol2'],
    nm: ['New Moves', ''],
    pacjm: ['Punishing and Correcting Joseki Mistakes', 'PunishingAndCorrectingJosekiMistakes'],
    ssj: ['Sekai no Shin Joseki', ''],
    shojiten: ['Shin Hayawakari Shojiten', 'ShinHayawakariShojiten'],
    sps: ['Star Point Joseki', 'StarPointJoseki'],
    tij: ['Tricks in Joseki', 'TricksInJoseki'],
}

/**
 * A source as Josekipedia records it: [book code, detail] or, for a professional player,
 * [player id, note, name]. Returns { title, detail, url } (url: its Sensei's Library page, or
 * null), or null for a code it doesn't know.
 */
export function describeSource(source) {
    if (!Array.isArray(source) || typeof source[0] !== 'string') { return null }
    const [id, detail = '', name = ''] = source
    const clean = (text) => String(text || '').trim()
    if (id.startsWith('player')) {
        return clean(name) ? { title: clean(name), detail: clean(detail), url: null } : null
    }
    const book = BOOKS[id]
    if (!book) { return null }
    return { title: book[0], detail: clean(detail), url: book[1] ? `https://senseis.xmp.net/?${book[1]}` : null }
}

/** An inline citation from a comment, "[src:code]" or "[src:code, detail]", in the same shape. */
export function describeCitation(text) {
    const comma = text.indexOf(',')
    return comma > 0 ? describeSource([text.slice(0, comma).trim(), text.slice(comma + 1)]) : describeSource([text.trim()])
}
