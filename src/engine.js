export function createSession(pathway) {
  let stack = [pathway.start];
  let picks = []; // picks[i] = index of the answer tapped at stack[i]

  const node = () => pathway.nodes[stack[stack.length - 1]];

  return {
    current: () => node(),
    answer(index) {
      const n = node();
      if (n.type !== 'question') throw new RangeError('cannot answer at an end node');
      if (!Number.isInteger(index) || index < 0 || index >= n.answers.length) {
        throw new RangeError(`answer index out of range: ${index}`);
      }
      picks.push(index);
      stack.push(n.answers[index].next);
    },
    back() {
      if (stack.length <= 1) return false;
      stack.pop();
      picks.pop();
      return true;
    },
    history: () => stack.slice(),
    // One entry per answered step: the question's node id and the index of the tapped answer.
    trail: () => picks.map((answer, i) => ({ node: stack[i], answer })),
    isEnd: () => node().type === 'end',
    restart() { stack = [pathway.start]; picks = []; },
  };
}
