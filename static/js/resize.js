const explorer = document.getElementById("file-explorer");
const thumb = document.getElementById("collapse-thumb");

thumb.addEventListener("click", () => {
  const collapsed = explorer.classList.toggle("collapsed");
  if (collapsed) {
    explorer.style.width = "0px";
    thumb.style.left = "0px";
    thumb.textContent = "❯";
  } else {
    explorer.style.width = "325px";
    thumb.style.left = "325px";
    thumb.textContent = "❮";
  }
});