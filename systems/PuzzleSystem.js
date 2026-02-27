export class PuzzleSystem {
  constructor() {
    this.puzzles = new Map();
  }

  register(puzzle) {
    this.puzzles.set(puzzle.id, puzzle);
  }

  complete(id) {
    const puzzle = this.puzzles.get(id);
    puzzle.completed = true;
  }

  isCompleted(id) {
    return this.puzzles.get(id)?.completed;
  }
}

// EJEMPLO DEPENDENCIA:

// if (inventory.hasItem("fuse_03")) {
//    puzzleSystem.complete("P-01");
//    electricity.activate();
// }
