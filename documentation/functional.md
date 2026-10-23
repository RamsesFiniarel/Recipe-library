# Functional description

## Architecture

The application is a website served by a local server on the home network. Each device opens it in its browser, with nothing to install and no account to create.

```
  Phones, tablets and computers at home
  (the browser renders the 3D, reads photos, makes PDFs)
                         │
                         │  local network
                         ▼
  ┌──────────────────────────────────────────────────┐
  │  Local server                                    │
  │                                                  │
  │  Node.js server                                  │
  │    ├ the application's pages and files           │
  │    └ the API: books, recipes, tags, nutrition,   │
  │      backups, reading web pages                  │
  │                                                  │
  │  data/cuisine.db      the library                │
  │  data/nutrition.db    nutritionnal value table   │
  │  data/backups/        one copy a day             │
  └──────────────────────────────────────────────────┘
                         │
                         │  only to import a web page
                         ▼
                      Internet
```

The browser loads nothing from the internet: fonts, 3D models and the photo reader are served by the local server. Only importing a recipe from a website sends a request out, made by the server and on demand.

The site has five pages:

```
Library                           /
 ├ Book                           /{book}
 │  └ Recipe                      /{book}/{recipe}
 └ Settings                       /parametres
    └ Nutrition database          /parametres/nutrition
```

A few rules apply everywhere:

- There is no "Save" button: every change is saved while typing, and an indicator confirms it.
- There are no accounts: any device on the network can read and change everything. A copy of the library is made every day.
- Recipes stay in the language they were written in; only the interface changes language.
- The "/" key opens the page's search, Escape closes whatever is open.

## Library

This is the home page.

### Welcome

At the top of the page: a question that follows the time of day ("What's cooking tonight?"), the number of recipes and books, and the search bar. Scrolling down leads to the library.

### Shelves

Books stand on three-dimensional shelves, showing their colour or cover pictures. A book reacts when hovered; a click opens it, then the book's page appears. Decorative objects, chosen in the settings, sit on the shelves.

### Search

The bar searches books and recipes at once. The arrow keys move through the results and Enter opens the first one. Filters narrow down the recipes; they are typed in the bar as commands and shown as chips, removed with a click:

| Command | Filter | Example |
|---|---|---|
| /i | recipes containing an ingredient (the most frequent ones are suggested) | /i tomato |
| /t | a tag | /t veggie |
| /c | a maximum time, in minutes | /c 30 |
| /p | a number of people, give or take one | /p 4 |

Several ingredients or tags add up. Typing "/" alone lists the commands.

### Menu

The menu at the top right leads to the settings, creates a new book (a title is enough) and opens edit mode.

### Edit mode

Clicking a book selects it and opens a panel to customise it:

- its title;
- its cover, plain (one colour) or illustrated, with a picture for the back, the spine and the front, laid out like an unfolded dust jacket;
- the colour of its pages (cream, ivory, sand or grey);
- its width, height and the gloss of its cover;
- a lit 3D preview, to judge the gloss.

A book is moved by dragging it, between two others or onto another shelf; the page scrolls by itself near the edges and the other books shift to make room. A button adds a shelf. Escape leaves edit mode.

## Book

A book's page uses its cover as a background.

- The title is edited in place at the top of the page.
- Recipes show as cards (title and number of people), whose corner curls up when hovered.
- A search field filters the book's recipes.
- The menu, behind the chef's hat, creates a new recipe, deletes the book after confirmation (saying how many recipes will go with it) and leads back to the library.

### New recipe

The dialog offers three ways to start. In each case, the recipe opens once created.

#### From scratch

Give a title, then fill in the recipe's page.

#### From photos

Pick or drop up to six photos, for instance the pages of a book or notebook. They are read in the device's browser, in French or English, with a progress bar. The application finds the title, the number of people, the times, the ingredients and the steps, columns and sub-sections included.

#### From a web page

Paste the recipe's address; a link with text around it, or a link dragged from another tab, also works. The server reads the page: first the data most recipe sites publish for search engines, otherwise the lists and the "Ingredients" and "Method" headings. The recipe gets the title, the number of people, the time, the ingredients with their groups ("For the sauce:") and the steps, then the page's address as its last line. When it can't be done, a message gives the reason: no recipe on the page, a site that refuses automated reading, page or site not found, a site that doesn't answer.

## Recipe

### Header

- The title is edited in place.
- Under the title, the recipe's tags. Automatic tags are computed by themselves; the "+" button adds one, a cross removes one. The refresh button clears these corrections and brings the automatic tags back one by one.
- The menu, behind the chef's hat, downloads the recipe as a PDF, deletes it after confirmation and leads back to the book.

### People and time

The number of people and the preparation time (in minutes, hours or days) are edited in place. The small arrows next to the number of people change it for one meal only: quantities are recomputed and shown in ochre, to make clear they are not saved. The saved number comes back on reload or when clicking into the field.

### Ingredients

Each line is a quantity, a unit and a name. Typing stays natural: with "2 onions", the cursor moves from the quantity to the name by itself; Enter starts a new line. A pasted list is split into lines. A line ending with ":" becomes a sub-heading ("For the dough:"). Common units are recognised, in French and English (g, ml, tbsp, cup, pinch…).

### Method and nutrition

Two tabs share the right side of the page.

- Method: the free text of the steps.
- Nutrition: a table of calories, carbohydrates, protein, fat, sugars, fibre, saturated fat and salt, per ingredient, in total and per person. Minerals and vitamins unfold below. An unknown food, a missing quantity or a unit of unknown weight is pointed out.

## Settings

The page has five sections, in this order:

| Section | Content |
|---|---|
| Language | French or English, for the interface and the food names |
| Backup | the date of the last automatic copy and a button to make one now; export of the whole library to a file; import of such a file, which replaces the library after confirmation (the current one is copied on the server first) |
| Nutrition database | the link to its page |
| Tags | the automatic tags with their rules, and personal tags, added or deleted (a deleted tag disappears from the recipes that had it) |
| Shelves | the objects on the shelves: salt and pepper, olive oil |

### Automatic tag rules

| Tag | Rule |
|---|---|
| Meal | savoury (under 8% sugars), at least 150 g per person |
| Dessert | sugar, honey or chocolate, at least 4% sugars, no meat, fish, pulses or sauce |
| Veggie | no meat, fish, stock or gelatine |
| Quick | preparation of 45 minutes at most |
| Spicy | chilli, harissa, Tabasco, cayenne, sriracha… |
| Light | meal or dessert under 450 kcal per person |
| Hearty | meal or dessert over 800 kcal per person |
| Solo, For 2, Family, Big table | meal or dessert for 1, 2, 3 to 7, or at least 8 people |

## Nutrition database

The foods of the Anses Ciqual table, with their values per 100 g. Foods can be searched by name and filtered by food group. This table is what the recipes' nutrition is computed from.

## Ideas for later

Noted for the future, not built: a cooking mode (screen kept on, larger text, steps to tick off), timers taken from the steps' durations, a shopping list from several recipes, a weekly meal plan, seasonal tags, a photo per recipe, a log of when recipes were made, unit conversion, an offline mode, an automatic copy of the backups to another machine, and a dark theme.
