const audios = document.querySelectorAll("audio");
const cards = document.querySelectorAll(".card");
const search = document.getElementById("search");
const volumeSlider = document.getElementById("volume");
const playlist = document.getElementById("playlist");
const themeBtn = document.getElementById("themeBtn");

search.addEventListener("keyup", () => {

    const value = search.value.toLowerCase();

    cards.forEach(card => {

        const song =
            card.querySelector(".song-name")
            .textContent
            .toLowerCase();

        if(song.includes(value)){
            card.style.display = "block";
        }
        else{
            card.style.display = "none";
        }

    });

});

themeBtn.addEventListener("click", () => {

    document.body.classList.toggle("light-mode");

    if(document.body.classList.contains("light-mode")){
        themeBtn.innerHTML = "☀ Light Mode";
    }
    else{
        themeBtn.innerHTML = "🌙 Dark Mode";
    }

});

volumeSlider.addEventListener("input", () => {

    audios.forEach(audio => {

        audio.volume =
        volumeSlider.value / 100;

    });

});

cards.forEach((card,index)=>{

    const item =
    document.createElement("div");

    item.classList.add("playlist-item");

    item.innerText =
    card.querySelector(".song-name")
    .innerText;

    playlist.appendChild(item);

    item.addEventListener("click",()=>{

        audios[index].play();

    });

});

audios.forEach(audio=>{

    audio.addEventListener("play",()=>{

        audios.forEach(a=>{

            if(a!==audio){
                a.pause();
            }

        });

        cards.forEach(card=>{

            card.classList.remove("playing");

        });

        audio.closest(".card")
        .classList.add("playing");

    });

    audio.addEventListener("pause",()=>{

        audio.closest(".card")
        .classList.remove("playing");

    });

});

document.querySelectorAll(".fav-btn")
.forEach(btn=>{

    btn.addEventListener("click",()=>{

        btn.innerHTML =
        btn.innerHTML === "🤍"
        ? "❤️"
        : "🤍";

    });

});

const canvas =
document.createElement("canvas");

document.getElementById("particles")
.appendChild(canvas);

const ctx =
canvas.getContext("2d");

canvas.width =
window.innerWidth;

canvas.height =
window.innerHeight;

const particles=[];

for(let i=0;i<120;i++){

    particles.push({

        x:Math.random()*canvas.width,

        y:Math.random()*canvas.height,

        r:Math.random()*3+1,

        dx:(Math.random()-0.5),

        dy:(Math.random()-0.5)

    });

}

function animate(){

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    particles.forEach(p=>{

        ctx.beginPath();

        ctx.arc(
            p.x,
            p.y,
            p.r,
            0,
            Math.PI*2
        );

        ctx.fillStyle =
        "rgba(255,255,255,.6)";

        ctx.fill();

        p.x += p.dx;
        p.y += p.dy;

        if(
            p.x < 0 ||
            p.x > canvas.width
        ){
            p.dx *= -1;
        }

        if(
            p.y < 0 ||
            p.y > canvas.height
        ){
            p.dy *= -1;
        }

    });

    requestAnimationFrame(
        animate
    );

}

animate();