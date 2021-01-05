const keywords = document.querySelector('#keywords')
const domain = document.querySelector('#domain')
const min = document.querySelector('#min')
const max = document.querySelector('#max')

const add = document.querySelector('#add')
const remove = document.querySelector('#remove')
const upload = document.querySelector('#upload')

const routinesList = document.querySelector('#routines')
const routinesCount = document.querySelector('#routinesCount')

let routines, selected

add.addEventListener('click', modify)
remove.addEventListener('click', deleteRoutine)

init()

function init()
{
    loadRoutines()
    .then(() => 
    {
        selected = -1
        render()
    })
}

function modify()
{
    if(selected < 0)
    {
        routines.push(createRoutineFromForm())
        selected = routines.length - 1
    }
    else
        routines[selected] = createRoutineFromForm()

    render()
}

function deleteRoutine()
{
    if(selected >= 0 && selected < routines.length)
        routines = routines.slice(0, selected).concat(routines.slice(selected + 1, routines.length))

    selected = -1

    render()
}

function loadRoutines()
{
    return new Promise(res =>
    {
        routines = [{"keyword": "iphone 11","domain": "https://www.jofogas.hu/budapest","min": 100000,"max": 500000}, {"keyword": "fullhd monitor","domain": "https://www.jofogas.hu/budapest","min": 100000,"max": 500000}]
        res()
    })
}

function handle(index)
{
    selected = index
    render()
}

function render()
{
    routinesCount.textContent = routines.length
    routinesList.innerHTML = ''
    routinesList.appendChild(generateNew())
    let iterator = 0
    for (const routine of routines) routinesList.appendChild(generateRoutineDOM(routine, iterator++))
    
    fillForm()
}

function generateRoutineDOM(routine, place)
{
    let li = document.createElement('li')
    let span = document.createElement('span')
    li.classList.add('list-group-item')
    li.classList.add('d-flex')
    li.classList.add('justify-content-between')
    li.classList.add('align-items-center')
    if(selected == place) li.classList.add('active')
    li.addEventListener('click', (event) =>
    {
        const pointer = place
        handle(pointer)
    })
    li.innerText = routine.keyword
    span.classList.add('badge')
    span.classList.add('badge-info')
    span.innerText = `${niceNumber(routine.min)} - ${niceNumber(routine.max)} Ft`
    li.appendChild(span)
    return li
}

function generateNew()
{
    let li = document.createElement('li')
    li.classList.add('list-group-item')
    if(selected < 0) li.classList.add('active')
    li.addEventListener('click', (event) => handle(-1))
    li.innerText = "Create new"
    return li
}

function fillForm()
{
    if(selected < 0)
    {
        keywords.value = ''
        domain.value = 'https://www.jofogas.hu/budapest'
        min.value = ''
        max.value = ''
    }
    else
    {
        keywords.value = routines[selected].keyword
        domain.value = routines[selected].domain
        min.value = routines[selected].min
        max.value = routines[selected].max
    }
}

function createRoutineFromForm()
{
    return {
        keyword : keywords.value,
        domain : domain.value,
        min : min.value,
        max : max.value
    }
}

function niceNumber(x) 
{
    return x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, " ");
}
