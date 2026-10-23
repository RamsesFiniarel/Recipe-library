/** Spreads the books (in shelf order) over shelves: a shelf holds at most
 * its usable width, and at least `minShelfCount` shelves are used (books
 * split into roughly equal shares) so it reads as furniture. Reading order
 * is kept; books touch (capacity is the sum of widths). */
export function layoutBooksIntoShelves(books, { shelfInnerWidth, minShelfCount = 1 }) {
  if (books.length === 0) return [[]];

  const totalWidth = books.reduce((sum, book) => sum + book.width, 0);
  const shelfCount = Math.max(1, minShelfCount, Math.ceil(totalWidth / shelfInnerWidth));
  const targetWidth = totalWidth / shelfCount;

  const shelves = [];
  let current = [];
  let currentWidth = 0;

  for (let i = 0; i < books.length; i += 1) {
    const book = books[i];
    const booksLeft = books.length - i;
    const shelvesLeft = shelfCount - shelves.length; // current shelf included

    const overflows = currentWidth + book.width > shelfInnerWidth;
    // Move on once the share is reached, if enough books remain for the
    // shelves below.
    const reachedShare =
      shelvesLeft > 1 && currentWidth + book.width / 2 > targetWidth && booksLeft > shelvesLeft - 1;

    if (current.length > 0 && (overflows || reachedShare)) {
      shelves.push(current);
      current = [];
      currentWidth = 0;
    }

    current.push(book);
    currentWidth += book.width;
  }

  shelves.push(current);
  return shelves;
}

/** Splits a shelf into left and right groups pushed against the edges,
 * leaving a gap, reading order kept. `seed` (in [0, 1), random by default)
 * sizes the split; scene.js freezes it per row so drag previews don't
 * jump. */
export function splitShelfLeftRight(rowBooks, seed = Math.random()) {
  if (rowBooks.length === 0) return { left: [], right: [] };
  if (rowBooks.length === 1) {
    return seed < 0.5 ? { left: rowBooks, right: [] } : { left: [], right: rowBooks };
  }

  const ratio = 0.25 + seed * 0.5; // 25% to 75% on the left
  const splitIndex = Math.min(Math.max(Math.round(rowBooks.length * ratio), 1), rowBooks.length - 1);

  return { left: rowBooks.slice(0, splitIndex), right: rowBooks.slice(splitIndex) };
}
