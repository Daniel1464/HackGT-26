from fastapi import FastAPI
import uvicorn

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "Hello World"}

if __name__ == "__main__":
    # This lets you run the file with `python main.py`
    uvicorn.run("main:app", host="127.0.0.1", port=6767, reload=True)
