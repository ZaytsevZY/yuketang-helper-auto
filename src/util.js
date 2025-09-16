export const PROBLEM_TYPE_MAP = {
  1: "单选题", 2: "多选题", 3: "投票题", 4: "填空题", 5: "主观题"
};

/**
 * Returns a random integer in [l, r].
 * @param {number} l
 * @param {number} r
 */
export function randInt(l, r) {
  return l + Math.floor(Math.random() * (r - l + 1));
}

/**
 * Shuffles the elements in the array.
 * @param {Array} array
 */
export function shuffleArray(array) {
  for (let i = 1; i < array.length; i++) {
    let j = randInt(0, i);
    if (j != i) {
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
  return array;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.onload = () => resolve(img);
    img.onerror = (evt) => {
      console.error(evt);
      reject(new Error("Failed to load image: " + src));
    };
  });
}

export function coverStyle(presentation) {
  const { width, height } = presentation;
  return { aspectRatio: width + '/' + height };
}
