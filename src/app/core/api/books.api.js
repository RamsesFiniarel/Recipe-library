import { http } from "./http.js";

const encode = encodeURIComponent;

export const booksApi = {
  list: () => http.get("/books"),
  searchIndex: () => http.get("/books/search-index"),
  get: (bookId) => http.get(`/books/${encode(bookId)}`),
  create: (title) => http.post("/books", { title }),
  update: (bookId, fields) => http.patch(`/books/${encode(bookId)}`, fields),
  reorder: (rows) => http.patch("/books/reorder", { rows }),
  remove: (bookId) => http.del(`/books/${encode(bookId)}`),
};
