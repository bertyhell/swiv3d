using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class MenuController : MonoBehaviour {
    [SerializeField] private MenuButton menuButtonTemplate;

    private readonly MenuInfo rootMenu;
    private MenuInfo activeMenu;
    private Canvas canvas;

    MenuController() {
        this.rootMenu = new MenuInfo("Main Menu", "Main Menu for Player NewPlayer", 0, false, new MenuInfo[] {
            new MenuInfo("Start Game", "Start Game", 0, false, new MenuInfo[]{ }),
            new MenuInfo("Setup", "Setup", 1, false, new MenuInfo[]{ }),
            new MenuInfo("Replay Intro", "Replay Intro", 2, false, new MenuInfo[]{ }),
            new MenuInfo("Credits", "Credits", 3, false, new MenuInfo[]{ }),
            new MenuInfo("New Player", "New Player", 4, false, new MenuInfo[]{ }),
            new MenuInfo("Exit", "Exit", 5, false, new MenuInfo[]{ }),
        });
    }
    
    // Start is called before the first frame update
    void Start()
    {
        this.canvas = GetComponent<Canvas>();
        renderMenu(rootMenu);
    }

    // Update is called once per frame
    void Update()
    {
        
    }

    void renderMenu(MenuInfo menu) {

        activeMenu = menu;
        foreach (MenuInfo menuInfo in activeMenu.subMenuItems) {
            MenuButton menuButton = Instantiate<MenuButton>(menuButtonTemplate, new Vector3(0, menuInfo.order * 10, 0), Quaternion.identity);
            menuButton.GetComponent<Transform>().SetParent(canvas.transform);
        }
    }
}
